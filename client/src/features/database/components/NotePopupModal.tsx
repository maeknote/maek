import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";
import { api } from "@renderer/shared/api";
import { makeTab, useStore } from "@renderer/features/workspace";
import type { FileContent } from "@shared/workspace";
import { MarkdownEditor } from "../../editor/MarkdownEditor";
import { TitleBar } from "../../editor/components/TitleBar";
import { FrontmatterPanel } from "../../editor/components/FrontmatterPanel";
export function NotePopupModal({
  relativePath,
  onClose,
  onSaved,
  onRename,
}: {
  /** Workspace-relative path, as required by the file API. */
  relativePath: string;
  onClose: () => void;
  onSaved?: () => void;
  onRename?: (name: string) => Promise<void>;
}) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === relativePath));
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const workspace = useStore.getState().workspace;
    const existing = useStore.getState().tabs.some((t) => t.id === relativePath);
    if (!existing)
      void api<FileContent>(
        `/api/files/content?path=${encodeURIComponent(relativePath)}`,
        "GET",
        undefined,
        workspace,
      )
        .then((file) => {
          if (cancelled) return;
          if (file.kind !== "editor") {
            setError("This file cannot be edited as a note.");
            return;
          }
          useStore.setState((s) =>
            s.tabs.some((t) => t.id === relativePath)
              ? s
              : {
                  tabs: [
                    ...s.tabs,
                    { ...makeTab(relativePath, file), isPopup: true },
                  ],
                },
          );
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
      // Keep failed drafts in the store. Never discard a note before save succeeds.
      if (!existing)
        void useStore
          .getState()
          .save(relativePath)
          .then((saved) => {
            if (saved)
              useStore.setState((s) => ({
                tabs: s.tabs.filter((t) => t.id !== relativePath || !t.isPopup),
              }));
          });
    };
  }, [relativePath]);
  async function save() {
    const saved = await useStore.getState().save(relativePath);
    if (saved) onSaved?.();
    return saved;
  }
  async function close() {
    if (await save()) onClose();
  }
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          void close();
        }
      }}
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => void close()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Database note"
        className="relative z-10 flex h-[min(840px,calc(100dvh-32px))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl glass-modal text-neutral-ink"
      >
        {error && (
          <div role="alert" className="m-5 rounded-xl border border-maek-red/30 bg-maek-red/10 p-4 text-sm text-maek-red">
            <p className="font-medium">Could not open this note</p>
            <p className="mt-1 text-xs text-maek-red/80">{error}</p>
          </div>
        )}
        {!tab && !error && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-text">
            <FileText size={16} aria-hidden="true" />
            Loading note…
          </div>
        )}
        {tab && (
          <>
            <TitleBar
              tab={tab}
              onRename={async (name) => {
                if (!(await save()))
                  throw new Error("Save the note before renaming");
                await onRename?.(name);
              }}
              actions={
                <button
                  type="button"
                  aria-label="Close note"
                  className="icon-button"
                  onClick={() => void close()}
                >
                  <X size={16} />
                </button>
              }
            />
            {tab.error && (
              <div role="alert" className="px-4 py-2 text-xs text-maek-red">
                {tab.error}
              </div>
            )}
            {tab.frontmatter.hasFrontmatter && (
              <FrontmatterPanel tab={tab} onSave={() => void save()} />
            )}
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
              <MarkdownEditor tab={tab} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
