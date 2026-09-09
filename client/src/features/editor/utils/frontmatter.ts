import { parseDocument } from "yaml";
import type {
  FrontmatterState,
  LineEnding,
  TabItem,
  TabOpenPayload,
} from "../types";

const FRONTMATTER_FENCE = "---";

function detectLineEnding(raw: string): LineEnding {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function trimSingleLeadingBlankLine(raw: string): string {
  if (raw.startsWith("\r\n")) return raw.slice(2);
  if (raw.startsWith("\n")) return raw.slice(1);
  return raw;
}

export function validateFrontmatterYaml(
  frontmatterRaw: string | null,
): string | null {
  if (frontmatterRaw === null) return null;

  const parsed = parseDocument(frontmatterRaw);
  if (parsed.errors.length === 0) return null;

  return parsed.errors.map((error) => error.message).join(" ");
}

export function createEmptyFrontmatterState(
  lineEnding: LineEnding = "\n",
): FrontmatterState {
  return {
    hasFrontmatter: false,
    raw: null,
    savedRaw: null,
    expanded: false,
    validationError: null,
    lineEnding,
    viewMode: "properties",
  };
}

export function splitFrontmatter(rawFile: string): TabOpenPayload {
  const lineEnding = detectLineEnding(rawFile);

  if (
    !rawFile.startsWith(`${FRONTMATTER_FENCE}\n`) &&
    !rawFile.startsWith(`${FRONTMATTER_FENCE}\r\n`)
  ) {
    return {
      bodyContent: rawFile,
      frontmatter: createEmptyFrontmatterState(lineEnding),
      viewKind: "editor",
      previewFormat: null,
      diskFileContent: rawFile,
    };
  }

  const match = rawFile.match(
    /^---(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)---(?:(?:\r\n|\n)([\s\S]*))?$/,
  );
  if (!match) {
    return {
      bodyContent: rawFile,
      frontmatter: createEmptyFrontmatterState(lineEnding),
      viewKind: "editor",
      previewFormat: null,
      diskFileContent: rawFile,
    };
  }

  const frontmatterRaw = match[1] ?? "";
  const bodyContent = trimSingleLeadingBlankLine(match[2] ?? "");

  return {
    bodyContent,
    frontmatter: {
      hasFrontmatter: true,
      raw: frontmatterRaw,
      savedRaw: frontmatterRaw,
      expanded: false,
      validationError: validateFrontmatterYaml(frontmatterRaw),
      lineEnding,
      viewMode: "properties",
    },
    viewKind: "editor",
    previewFormat: null,
    diskFileContent: rawFile,
  };
}

export function composeMarkdownFile(
  frontmatterRaw: string | null,
  body: string,
  lineEnding: LineEnding = "\n",
): string {
  if (frontmatterRaw === null) return body;

  const normalizedBody = body.replace(/^\r?\n+/, "");
  const frontmatterBlock = `${FRONTMATTER_FENCE}${lineEnding}${frontmatterRaw}${lineEnding}${FRONTMATTER_FENCE}`;

  if (!normalizedBody) return frontmatterBlock;

  return `${frontmatterBlock}${lineEnding}${lineEnding}${normalizedBody}`;
}

export function createEmptyTabOpenPayload(): TabOpenPayload {
  return {
    bodyContent: "",
    frontmatter: createEmptyFrontmatterState(),
    viewKind: "editor",
    previewFormat: null,
    diskFileContent: "",
  };
}

export function isTabDirty(tab: TabItem): boolean {
  if (!isEditableMarkdownTab(tab)) return false;
  return (
    tab.bodyContent !== tab.savedBodyContent ||
    tab.frontmatter.raw !== tab.frontmatter.savedRaw
  );
}

export function isEditableMarkdownTab(tab: TabItem): boolean {
  return tab.viewKind === "editor" || tab.viewKind === "meeting";
}

export function getTabSavePath(tab: TabItem): string {
  return tab.viewKind === "meeting"
    ? (tab.meetingNotePath ?? `${tab.id}/note.md`)
    : tab.id;
}

export function getTabFileContent(tab: TabItem): string {
  return composeMarkdownFile(
    tab.frontmatter.raw,
    tab.bodyContent,
    tab.frontmatter.lineEnding,
  );
}

/**
 * Returns true when the tab's current state represents an actual user edit relative to the
 * on-disk file — not just a Tiptap parse/serialize normalization difference.
 *
 * `diskNormalizedBody` is captured in EditorPane onCreate by feeding the disk body through
 * Tiptap once and capturing the round-trip result. After that, comparing `bodyContent` to
 * `diskNormalizedBody` reveals whether the user has actually changed the document.
 *
 * Falls back to `savedBodyContent` when `diskNormalizedBody` has not been populated yet
 * (e.g. between a `reloadContent` and the next `setContent` cycle).
 */
export function hasSemanticChangeFromDisk(tab: TabItem): boolean {
  if (!isEditableMarkdownTab(tab)) return false;
  const baseline =
    tab.diskNormalizedBody !== ""
      ? tab.diskNormalizedBody
      : tab.savedBodyContent;
  if (tab.bodyContent !== baseline) return true;
  if (tab.frontmatter.raw !== tab.frontmatter.savedRaw) return true;
  return false;
}

export function getFrontmatterLineCount(frontmatterRaw: string | null): number {
  if (!frontmatterRaw) return 0;
  return frontmatterRaw.split(/\r?\n/).length;
}
