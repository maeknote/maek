import { dirname, resolvePath } from "../../../lib/pathUtils";
import { useStore } from "../../../store";
export function getWorkspaceTargetDisplayName(p: string) {
  return (
    useStore.getState().nodes.find((n) => n.id === p)?.name ??
    p.split("/").pop() ??
    p
  );
}
export function getWorkspaceTargetIsDatabase(_p: string) {
  return false;
}
export async function openWorkspaceTargetHref(source: string, href: string) {
  await useStore
    .getState()
    .openFile(resolvePath(dirname(source), href).replace(/^\//, ""));
  return true;
}
