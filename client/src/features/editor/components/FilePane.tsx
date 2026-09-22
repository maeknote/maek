import {
  lazy,
  Suspense,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Columns2,
  ExternalLink,
  FileText,
  RefreshCw,
} from "lucide-react";
import {
  useStore,
  type Tab,
} from "@renderer/features/workspace";
import {
  api,
  rawUrl,
  webArtifactUrl,
} from "@renderer/shared/api";
import { Button } from "@renderer/shared/components";
import { CustomPagePreview } from "@renderer/features/custom-page";
import { isTabDirty } from "../utils/frontmatter";
import { MarkdownEditor } from "../MarkdownEditor";
import { TitleBar } from "./TitleBar";
import { ViewerToolbar } from "./ViewerToolbar";

const SpreadsheetEditor = lazy(
  () => import("../../spreadsheet/SpreadsheetEditor"),
);


/** Read-only preview body. The file name lives in the ViewerToolbar, so the
 *  unsupported view no longer repeats it. */
function PreviewBody({ tab }: { tab: Tab }): ReactElement {
  const setError = useStore((s) => s.setError);
  if (tab.file.kind === "image")
    return (
      <div className="flex-1 min-h-0 overflow-auto p-8 flex items-center justify-center">
        <img
          src={rawUrl(tab.id) + "&v=" + tab.generation}
          alt={tab.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  if (tab.file.kind === "pdf")
    return (
      <iframe
        title={tab.name}
        src={rawUrl(tab.id)}
        className="flex-1 min-h-0 w-full"
      />
    );
  if (tab.file.kind === "text")
    return (
      <pre className="flex-1 min-h-0 overflow-auto p-8 text-sm whitespace-pre-wrap font-mono">
        {tab.file.content}
      </pre>
    );
  if (tab.file.kind === "html")
    return <CustomPagePreview key={tab.id} tab={tab} />;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-text">
      <FileText size={40} />
      <p>Unsupported file format</p>
      <Button
        variant="outline"
        onClick={() =>
          void api("/api/files/open-external", "POST", { path: tab.id }).catch(
            (e) => setError(String(e)),
          )
        }
      >
        <ExternalLink size={16} />
        Open in default app
      </Button>
    </div>
  );
}

interface FilePaneProps {
  pane: "left" | "right";
  tab: Tab;
  /** True when both panes are showing a file (split view). */
  isSplit: boolean;
  /** Open the "open file to the side" picker (left pane only). */
  onOpenToSide: () => void;
  /** Save a copy of the tab (conflict resolution). */
  onSaveCopy: (tab: Tab) => void;
}

/**
 * Unified renderer for a single editor/viewer pane. Both the primary pane and
 * the split pane use this so their headers and per-file actions stay in sync.
 * The header is a large TitleBar for markdown editors and a compact
 * ViewerToolbar for every other file kind (HTML, image, PDF, text, CSV,
 * unsupported).
 */
export function FilePane({
  pane,
  tab,
  isSplit,
  onOpenToSide,
  onSaveCopy,
}: FilePaneProps): ReactElement {
  const state = useStore();

  const rename = (name: string) =>
    state.move(tab.id, [...tab.id.split("/").slice(0, -1), name].join("/"));

  // Common actions shared by every file kind.
  const commonActions: ReactNode = (
    <>
      {isSplit ? (
        <button
          type="button"
          onClick={() => state.singlePane(pane)}
          className="icon-button"
          aria-label="Single pane"
        >
          <Columns2 size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenToSide}
          className="icon-button"
          aria-label="Open file to the side"
        >
          <Columns2 size={14} />
        </button>
      )}
    </>
  );

  // HTML artifacts additionally get an explicit reload and open-in-browser.
  const htmlActions: ReactNode =
    tab.file.kind === "html" ? (
      <>
        <button
          type="button"
          onClick={() => state.refreshPreview(tab.id)}
          className="icon-button"
          aria-label="Reload HTML preview"
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          onClick={() =>
            window.open(
              webArtifactUrl(tab.id),
              "_blank",
              "noopener,noreferrer",
            )
          }
          className="icon-button"
          aria-label="Open in browser"
        >
          <ExternalLink size={14} />
        </button>
      </>
    ) : null;

  const viewerActions = (
    <>
      {htmlActions}
      {commonActions}
    </>
  );

  const isMarkdown = tab.viewKind === "editor";

  const header = isMarkdown ? (
    <TitleBar tab={tab} onRename={rename} actions={commonActions} />
  ) : (
    <ViewerToolbar tab={tab} onRename={rename} actions={viewerActions} />
  );

  const body =
    tab.viewKind === "editor" ? (
      <MarkdownEditor key={tab.id + ":" + tab.generation} tab={tab} />
    ) : tab.viewKind === "spreadsheet" ? (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-muted-text">
            Loading spreadsheet…
          </div>
        }
      >
        <SpreadsheetEditor key={tab.id + ":" + tab.generation} tab={tab} />
      </Suspense>
    ) : (
      <PreviewBody tab={tab} />
    );

  return (
    <div
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      onPointerDown={() => state.setSplitActive(pane)}
    >
      {header}
      {tab.status === "conflict" || tab.status === "error" ? (
        <div role="alert" className="notice">
          <span>{tab.error}</span>
          <button
            onClick={() => {
              if (
                !isTabDirty(tab) ||
                window.confirm("Discard local edits and reload from disk?")
              )
                void state.reload(tab.id);
            }}
          >
            Reload
          </button>
          <button onClick={() => onSaveCopy(tab)}>Save a copy</button>
          <button
            onClick={() => {
              if (window.confirm("Discard local edits and close?")) {
                void state.closeTab(tab.id);
              }
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      {body}
    </div>
  );
}
