import { create } from "zustand";
import type { WorkspaceRef } from "@shared/contract";
import { EditorUiStateSchema, type EditorUiState } from "@shared/editor";
import { api, browserProfileId } from "@renderer/shared/api";

interface HeadingCollapseState {
  byWorkspace: Record<string, Record<string, string[]>>;
  setCollapsed: (workspace: WorkspaceRef, path: string, keys: string[]) => void;
}
const pending = new Map<string, { workspace: WorkspaceRef; patch: Record<string, string[]> }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`maek:headings:${browserProfileId}`);

function merge(root: string, patch: Record<string, string[]>) {
  useHeadingCollapseStore.setState((state) => {
    const notes = { ...state.byWorkspace[root] };
    for (const [path, keys] of Object.entries(patch)) {
      if (keys.length) notes[path] = keys;
      else delete notes[path];
    }
    return { byWorkspace: { ...state.byWorkspace, [root]: notes } };
  });
}
function schedule(workspace: WorkspaceRef, patch: Record<string, string[]>) {
  merge(workspace.root, patch);
  channel?.postMessage({ root: workspace.root, patch });
  const previous = pending.get(workspace.root);
  pending.set(workspace.root, { workspace, patch: { ...previous?.patch, ...patch } });
  clearTimeout(timers.get(workspace.root));
  timers.set(workspace.root, setTimeout(() => void flushHeadingState(workspace), 300));
}
export const useHeadingCollapseStore = create<HeadingCollapseState>(() => ({
  byWorkspace: {},
  setCollapsed: (workspace, path, keys) => {
    const previous = useHeadingCollapseStore.getState().byWorkspace[workspace.root]?.[path] ?? [];
    if (JSON.stringify(previous) !== JSON.stringify(keys)) schedule(workspace, { [path]: keys });
  },
}));

export async function flushHeadingState(workspace: WorkspaceRef): Promise<void> {
  clearTimeout(timers.get(workspace.root));
  const current = writes.get(workspace.root);
  if (current) { await current; return flushHeadingState(workspace); }
  const update = pending.get(workspace.root);
  if (!update) return;
  pending.delete(workspace.root);
  const body = { collapsedHeadings: update.patch };
  const keepalive = new TextEncoder().encode(JSON.stringify(body)).byteLength < 60_000;
  const task = api<EditorUiState>("/api/workspace/editor-state", "PUT", body, workspace, undefined, { keepalive })
    .then(() => {})
    .catch((error) => {
      const newer = pending.get(workspace.root);
      pending.set(workspace.root, { workspace, patch: { ...update.patch, ...newer?.patch } });
      window.dispatchEvent(new CustomEvent("maek:editor-state-error", { detail: String(error) }));
    });
  writes.set(workspace.root, task);
  await task;
  if (writes.get(workspace.root) === task) writes.delete(workspace.root);
}
export async function loadHeadingState(workspace: WorkspaceRef): Promise<void> {
  await flushHeadingState(workspace);
  const state = EditorUiStateSchema.parse(await api<EditorUiState>("/api/workspace/editor-state", "GET", undefined, workspace));
  useHeadingCollapseStore.setState((current) => ({ byWorkspace: {
    ...current.byWorkspace, [workspace.root]: { ...state.collapsedHeadings, ...pending.get(workspace.root)?.patch },
  } }));
}
export function remapHeadingState(workspace: WorkspaceRef, source: string, dest?: string) {
  const patch: Record<string, string[]> = {};
  for (const [path, keys] of Object.entries(useHeadingCollapseStore.getState().byWorkspace[workspace.root] ?? {})) {
    if (path !== source && !path.startsWith(source + "/")) continue;
    patch[path] = [];
    if (dest !== undefined) patch[dest + path.slice(source.length)] = keys;
  }
  if (Object.keys(patch).length) schedule(workspace, patch);
}
channel?.addEventListener("message", (event) => {
  const message = event.data as { root?: unknown; patch?: unknown };
  if (typeof message.root !== "string") return;
  const parsed = EditorUiStateSchema.safeParse({ collapsedHeadings: message.patch });
  if (parsed.success) {
    const update = pending.get(message.root);
    if (update) for (const path of Object.keys(parsed.data.collapsedHeadings)) delete update.patch[path];
    merge(message.root, parsed.data.collapsedHeadings);
  }
});
window.addEventListener("pagehide", () => {
  for (const { workspace } of pending.values()) void flushHeadingState(workspace);
});
