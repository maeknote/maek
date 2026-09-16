import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml'

/**
 * Frontmatter split/compose — the single implementation (4A).
 *
 * Parsing lives in `shared/` because two callers need identical boundary
 * behaviour: the server (DB index sync, later) and the client (editor
 * frontmatter panel). Two implementations means the boundaries drift, and
 * drifting boundaries silently mutate files on round-trip.
 *
 * Three boundaries carry the weight, and every one of them is load-bearing:
 *   - detectLineEnding           CRLF vs LF
 *   - trimSingleLeadingBlankLine exactly one leading blank line, not many
 *   - FRONTMATTER_FENCE          the open-fence test and the closing regex
 *
 * `bodySeparator` is what makes the round-trip lossless. Re-composing to a
 * fixed `fence + LE + LE + body` would rewrite a file stored as
 * `---\nfm\n---\nbody` (no blank line) into `---\nfm\n---\n\nbody` — a byte
 * change to a file nobody edited. That breaks the mandatory "unmodified
 * round-trip is byte-identical" test (4A) and violates the file-is-truth
 * principle. Capturing the exact separator bytes avoids it; omitting the
 * argument falls back to the canonical form, which is what NEW frontmatter
 * should be written as.
 */

export const FRONTMATTER_FENCE = '---'

export type LineEnding = '\n' | '\r\n'

export interface SplitFile {
  /** YAML text between the fences, fences excluded. `null` = no frontmatter. */
  frontmatterRaw: string | null
  /** Document body after the closing fence and its separator. */
  body: string
  lineEnding: LineEnding
  /** Exact bytes between the closing fence and the body. Round-trip fidelity. */
  bodySeparator: string
}

export function detectLineEnding(raw: string): LineEnding {
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

function trimSingleLeadingBlankLine(raw: string): string {
  if (raw.startsWith('\r\n')) return raw.slice(2)
  if (raw.startsWith('\n')) return raw.slice(1)
  return raw
}

export function splitFrontmatterFile(rawFile: string): SplitFile {
  const lineEnding = detectLineEnding(rawFile)

  if (
    !rawFile.startsWith(`${FRONTMATTER_FENCE}\n`) &&
    !rawFile.startsWith(`${FRONTMATTER_FENCE}\r\n`)
  ) {
    return { frontmatterRaw: null, body: rawFile, lineEnding, bodySeparator: '' }
  }

  // Reference regex, with the newline after the closing fence captured (group 2)
  // instead of discarded, so bodySeparator can be reconstructed exactly.
  const match = rawFile.match(
    /^---(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)---(?:(\r\n|\n)([\s\S]*))?$/
  )
  if (!match) {
    return { frontmatterRaw: null, body: rawFile, lineEnding, bodySeparator: '' }
  }

  const frontmatterRaw = match[1] ?? ''

  // No group 2 => the file ends at the closing fence: no separator, no body.
  if (match[2] === undefined) {
    return { frontmatterRaw, body: '', lineEnding, bodySeparator: '' }
  }

  const afterFence = match[2] + (match[3] ?? '')
  const body = trimSingleLeadingBlankLine(match[3] ?? '')
  // `body` is always a suffix of `afterFence`, so the prefix is the separator.
  const bodySeparator = afterFence.slice(0, afterFence.length - body.length)

  return { frontmatterRaw, body, lineEnding, bodySeparator }
}

/**
 * Inverse of splitFrontmatterFile.
 *
 * Pass the `bodySeparator` from the split to get a byte-exact round-trip.
 * Omit it for the canonical form (blank line between fence and body), which is
 * what newly-created frontmatter should use.
 */
export function composeMarkdownFile(
  frontmatterRaw: string | null,
  body: string,
  lineEnding: LineEnding = '\n',
  bodySeparator?: string
): string {
  if (frontmatterRaw === null) return body

  const block = `${FRONTMATTER_FENCE}${lineEnding}${frontmatterRaw}${lineEnding}${FRONTMATTER_FENCE}`

  if (bodySeparator !== undefined) return `${block}${bodySeparator}${body}`

  const normalizedBody = body.replace(/^\r?\n+/, '')
  if (!normalizedBody) return block
  return `${block}${lineEnding}${lineEnding}${normalizedBody}`
}

/** Re-compose a split without changing anything. Byte-identical by construction. */
export function recomposeSplitFile(split: SplitFile, body: string = split.body): string {
  return composeMarkdownFile(split.frontmatterRaw, body, split.lineEnding, split.bodySeparator)
}

/** Parse YAML frontmatter text into a flat key/value map (best-effort). */
export function parseYamlData(frontmatterRaw: string | null): Record<string, unknown> {
  if (!frontmatterRaw || frontmatterRaw.trim() === '') return {}
  try {
    const parsed = parseYaml(frontmatterRaw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Serialize an object back into YAML text for frontmatter. */
export function serializeYamlData(data: Record<string, unknown>): string {
  // Strip trailing newline so composeMarkdownFile adds fences cleanly.
  return stringifyYaml(data).replace(/\n$/, '')
}

/** Patch one top-level property while retaining YAML comments, key order and unrelated nodes. */
export function patchYamlField(frontmatterRaw: string | null, key: string, value: unknown): string | null {
  if (frontmatterRaw === null && (value === undefined || value === null || value === '')) return null
  const document = parseDocument(frontmatterRaw ?? '', { uniqueKeys: true, strict: true })
  if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join('; '))
  if (value === undefined || value === null || value === '') document.delete(key)
  else document.set(key, value)
  if (!document.contents || (document.contents && 'items' in document.contents && document.contents.items.length === 0)) return null
  return document.toString({ lineWidth: 0 }).replace(/\n$/, '')
}

/** Rename one top-level key in place so its value, comments, and position survive. */
export function renameYamlField(frontmatterRaw: string | null, from: string, to: string): string | null {
  if (frontmatterRaw === null || from === to) return frontmatterRaw
  const document = parseDocument(frontmatterRaw, { uniqueKeys: true, strict: true })
  if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join('; '))
  const contents = document.contents as { items?: Array<{ key?: { value?: unknown } | unknown }> } | null
  const pair = contents?.items?.find((item) => {
    const key = item.key
    return typeof key === 'object' && key !== null && 'value' in key
      ? String((key as { value?: unknown }).value) === from
      : String(key) === from
  })
  if (!pair) return frontmatterRaw
  if (document.has(to)) throw new Error(`Cannot rename ${from}: ${to} already exists`)
  pair.key = document.createNode(to)
  return document.toString({ lineWidth: 0 }).replace(/\n$/, '')
}

/**
 * Replace exactly one key's line(s) in raw YAML text, leaving every other line
 * byte-identical (4A, goal 2). Full YAML re-serialization would rewrite
 * comments, quote styles, key order and scalar forms across the whole block.
 *
 * Only handles top-level `key: scalar` lines — the case the frontmatter panel
 * actually edits. Returns `null` when the key is absent or its value spans
 * multiple lines (nested map, block scalar, flow list); the caller must then
 * decide whether a full re-serialize is acceptable.
 */
export function replaceScalarField(
  frontmatterRaw: string,
  key: string,
  value: string
): string | null {
  const lineEnding = detectLineEnding(frontmatterRaw)
  const lines = frontmatterRaw.split(/\r\n|\n/)
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const keyLine = new RegExp(`^${escapedKey}:[ \\t]*(.*)$`)

  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if (keyLine.test(lines[i] ?? '')) {
      index = i
      break
    }
  }
  if (index === -1) return null

  // A continuation line (deeper indentation or a `- ` item) means the value is
  // not a single scalar; refuse rather than corrupt it.
  const next = lines[index + 1]
  if (next !== undefined && /^(\s+\S|\s*- )/.test(next)) return null

  lines[index] = `${key}: ${value}`
  return lines.join(lineEnding)
}
