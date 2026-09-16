import { describe, expect, it } from 'vitest'
import {
  composeMarkdownFile,
  detectLineEnding,
  parseYamlData,
  patchYamlField,
  renameYamlField,
  recomposeSplitFile,
  replaceScalarField,
  splitFrontmatterFile
} from '@shared/frontmatter'

/**
 * T4 verify: unmodified round-trip is byte-identical, plus the boundary cases
 * that actually turn up in real note folders (CRLF, one leading blank line,
 * empty fence).
 *
 * The round-trip claim only holds WITHOUT modification — a general YAML parser
 * does not preserve comments, quote style, key order or scalar form, so the
 * moment a field changes the rest of the block is rewritten. That is why the
 * second describe block tests single-field replacement separately.
 */
describe('splitFrontmatterFile / composeMarkdownFile — unmodified round-trip', () => {
  const cases: Array<[string, string]> = [
    ['no frontmatter', '# 제목\n\n본문입니다.\n'],
    ['blank line after fence', '---\ntitle: a\n---\n\n# 본문\n'],
    ['no blank line after fence', '---\ntitle: a\n---\n# 본문\n'],
    ['two blank lines after fence', '---\ntitle: a\n---\n\n\n# 본문\n'],
    ['CRLF throughout', '---\r\ntitle: a\r\n---\r\n\r\n# 본문\r\n'],
    ['ends at closing fence', '---\ntitle: a\n---'],
    ['newline then nothing', '---\ntitle: a\n---\n'],
    ['empty frontmatter block', '---\n\n---\n\n본문\n'],
    ['fence-looking text in body', '---\ntitle: a\n---\n\n본문\n\n---\n\n더\n'],
    ['no trailing newline', '---\ntitle: a\n---\n\n본문'],
    ['empty file', ''],
    ['body only, leading blank line', '\n\n본문\n']
  ]

  for (const [name, raw] of cases) {
    it(`is byte-identical: ${name}`, () => {
      const split = splitFrontmatterFile(raw)
      expect(recomposeSplitFile(split)).toBe(raw)
    })
  }

  it('detects CRLF and LF', () => {
    expect(detectLineEnding('a\r\nb')).toBe('\r\n')
    expect(detectLineEnding('a\nb')).toBe('\n')
    expect(detectLineEnding('a')).toBe('\n')
  })

  it('trims exactly one leading blank line, not all of them', () => {
    const one = splitFrontmatterFile('---\ntitle: a\n---\n\n본문\n')
    expect(one.body).toBe('본문\n')

    const two = splitFrontmatterFile('---\ntitle: a\n---\n\n\n본문\n')
    // The second blank line belongs to the body and must survive.
    expect(two.body).toBe('\n본문\n')
  })

  it('treats an unterminated fence as body, not frontmatter', () => {
    const raw = '---\ntitle: a\n\n본문\n'
    const split = splitFrontmatterFile(raw)
    expect(split.frontmatterRaw).toBeNull()
    expect(recomposeSplitFile(split)).toBe(raw)
  })

  it('parses YAML into a flat map and tolerates broken YAML', () => {
    const split = splitFrontmatterFile('---\ntitle: a\ncount: 3\n---\n\n본문\n')
    expect(parseYamlData(split.frontmatterRaw)).toEqual({ title: 'a', count: 3 })
    expect(parseYamlData('key: [unclosed')).toEqual({})
    expect(parseYamlData(null)).toEqual({})
  })

  it('composes canonical form when no separator is supplied', () => {
    expect(composeMarkdownFile('title: a', '본문')).toBe('---\ntitle: a\n---\n\n본문')
    expect(composeMarkdownFile(null, '본문')).toBe('본문')
    expect(composeMarkdownFile('title: a', '')).toBe('---\ntitle: a\n---')
  })

  it('round-trips an edited body while preserving the frontmatter bytes', () => {
    const raw = '---\ntitle: a   # 주석\nkeys:\n  - x\n---\n\n원래 본문\n'
    const split = splitFrontmatterFile(raw)
    const next = recomposeSplitFile(split, '새 본문\n')
    expect(next).toBe('---\ntitle: a   # 주석\nkeys:\n  - x\n---\n\n새 본문\n')
  })
})

describe('patchYamlField', () => {
  it('preserves comments and unrelated nodes for typed database edits', () => {
    const raw = 'title: original # keep\ntags: [a, b]\nstatus: Todo'
    expect(patchYamlField(raw, 'status', 'Done')).toContain('title: original # keep')
    expect(parseYamlData(patchYamlField(raw, 'status', 'Done'))).toEqual({ title: 'original', tags: ['a', 'b'], status: 'Done' })
  })
  it('adds and removes top-level values', () => {
    expect(parseYamlData(patchYamlField('title: a', 'checked', true))).toEqual({ title: 'a', checked: true })
    expect(patchYamlField('status: Todo', 'status', null)).toBeNull()
  })
  it('rejects invalid YAML instead of replacing it', () => {
    expect(() => patchYamlField('key: [unclosed', 'status', 'Done')).toThrow()
  })
  it('renames a key without moving its comment or value', () => {
    expect(renameYamlField('title: Task # keep\nStatus: To Do # lane\nowner: me', 'Status', 'Stage')).toBe(
      'title: Task # keep\nStage: To Do # lane\nowner: me',
    )
  })
})

describe('replaceScalarField — single-field edit preserves other lines', () => {
  const fm = 'title: 원래\ntags: [a, b]  # 주석\ncount: 3'

  it('changes only the target line', () => {
    const next = replaceScalarField(fm, 'title', '바뀜')
    expect(next).toBe('title: 바뀜\ntags: [a, b]  # 주석\ncount: 3')
  })

  it('returns null for an absent key', () => {
    expect(replaceScalarField(fm, 'missing', 'x')).toBeNull()
  })

  it('refuses multi-line values rather than corrupting them', () => {
    const nested = 'title: a\nkeys:\n  - x\n  - y'
    expect(replaceScalarField(nested, 'keys', 'z')).toBeNull()
  })

  it('preserves CRLF', () => {
    const crlf = 'title: 원래\r\ncount: 3'
    expect(replaceScalarField(crlf, 'title', '바뀜')).toBe('title: 바뀜\r\ncount: 3')
  })
})
