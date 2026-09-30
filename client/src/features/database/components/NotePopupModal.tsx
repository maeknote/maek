import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";
import { api } from "@renderer/shared/api";
import { makeTab, useStore, disposeEditBuffer } from "@renderer/features/workspace";
import type { FileContent } from "@shared/workspace";
import { MarkdownEditor, TitleBar, FrontmatterPanel } from "@renderer/features/editor";
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
  const renameTask = useRef<Promise<void> | null>(null);
  const currentPath = useRef(relativePath);
  const ownedSession = useRef<string | null>(null);
  currentPath.current = relativePath;
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
          useStore.setState((s) => {
            if (s.tabs.some((t) => t.id === relativePath)) return s;
            const created = { ...makeTab(relativePath, file), isPopup: true };
            ownedSession.current = created.editorSessionId;
            return { tabs: [...s.tabs, created] };
          });
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [relativePath]);
  useEffect(() => () => {
    // A rename keeps the same editor session. Remove only the popup-owned
    // draft on final unmount, after saving at its current path succeeds.
    const owned = useStore.getState().tabs.find(t => t.editorSessionId === ownedSession.current && t.isPopup);
    if (!owned) return;
    void useStore.getState().save(owned.id).then(saved => {
      if (!saved) return;
      disposeEditBuffer(owned.editorSessionId);
      useStore.setState(state => ({ tabs: state.tabs.filter(t => t.editorSessionId !== owned.editorSessionId || !t.isPopup) }));
    });
  }, []);
  async function save() {
    const saved = await useStore.getState().save(currentPath.current);
    if (saved) onSaved?.();
    return saved;
  }
  async function close() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    try {
      await renameTask.current;
      const saved = await useStore.getState().save(currentPath.current);
      if (saved) { onSaved?.(); onClose(); }
    } catch (e) { setError(String(e)); }
  }
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          event.stopPropagation();
          const active = document.activeElement;
          if (active instanceof HTMLElement) active.blur();
          void Promise.resolve(renameTask.current).then(() => save()).catch(e => setError(String(e)));
        }
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
              onRename={(name) => {
                const task = (async () => {
                  if (!(await save())) throw new Error("Save the note before renaming");
                  await onRename?.(name);
                })();
                renameTask.current = task;
                void task.finally(() => { if (renameTask.current === task) renameTask.current = null; }).catch(() => {});
                return task;
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
              <MarkdownEditor tab={tab} onSave={save} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
