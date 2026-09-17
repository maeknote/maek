import type { WorkspaceRef } from "@shared/contract";
let workspace: WorkspaceRef | null = null;
const sessionKey = "maek:browser-session";
export const browserSessionId =
  sessionStorage.getItem(sessionKey) ??
  sessionStorage.getItem("oh-my-maek:browser-session") ??
  crypto.randomUUID();
sessionStorage.setItem(sessionKey, browserSessionId);
export function setHostWorkspace(ws: WorkspaceRef) {
  workspace = ws;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  ws = workspace,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(ws ? { "X-Workspace-Id": ws.wsId } : {}),
      "X-Client-Session-Id": browserSessionId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.message ?? "Request failed",
      response.status,
      result.error,
    );
  return result as T;
}
export const rawUrl = (p: string) =>
  `/api/files/raw?workspace=${encodeURIComponent(workspace?.wsId ?? "")}&path=${encodeURIComponent(p.replace(/^\//, ""))}`;
const workspaceFileUrl = (route: "_artifacts" | "_web", p: string) => {
  const segments = p.replace(/^\//, "").split("/").map(encodeURIComponent);
  return `${location.protocol}//localhost:${location.port}/${route}/${encodeURIComponent(workspace?.wsId ?? "")}/${segments.join("/")}`;
};
export const artifactUrl = (p: string) => workspaceFileUrl("_artifacts", p);
export const webArtifactUrl = (p: string) => workspaceFileUrl("_web", p);
export async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
// Small, typed adapter for the imported ImageView. It has no Electron dependency.
window.api = {
  async readPreviewSource(p: string) {
    try {
      const response = await fetch(rawUrl(p));
      if (!response.ok) throw new Error("Image could not be read");
      return {
        success: true as const,
        bytes: await response.arrayBuffer(),
        mime: response.headers.get("content-type") ?? undefined,
      };
    } catch (e) {
      return { success: false as const, error: String(e) };
    }
  },
  async deleteFile(p: string) {
    await api("/api/files", "DELETE", { paths: [p] });
  },
};
