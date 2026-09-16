import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "../../../host";
import { makeTab, useStore } from "../../../store";
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
      className="fixed inset-0 z-50"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          void close();
        }
      }}
    >
      <div
        className="absolute inset-0 bg-black/15"
        onClick={() => void close()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Database note"
        className="absolute inset-6 flex flex-col overflow-hidden glass-modal"
      >
        <button
          aria-label="Close note"
          className="absolute top-3 right-3 z-10 p-2"
          onClick={() => void close()}
        >
          <X size={16} />
        </button>
        {error && (
          <div role="alert" className="p-6 text-maek-red">
            {error}
          </div>
        )}
        {!tab && !error && <div className="p-6">Loading note…</div>}
        {tab && (
          <>
            <TitleBar
              tab={tab}
              onRename={async (name) => {
                if (!(await save()))
                  throw new Error("Save the note before renaming");
                await onRename?.(name);
              }}
            />
            <div className="px-8 text-xs text-muted-text">{relativePath}</div>
            {tab.error && (
              <div role="alert" className="px-8 text-maek-red">
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
