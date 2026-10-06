import { useEffect, useRef, useState, type ReactElement } from "react";
import type { CustomPageMountResult } from "@shared/custom-page";
import { api, artifactUrl, customPageUrl } from "@renderer/shared/api";
import { Button } from "@renderer/shared/components";
import { useStore, type Tab } from "@renderer/features/workspace";

/** Mounts a manifest-backed custom page and releases its server mount on exit. */
export function CustomPagePreview({ tab, active = true }: { tab: Tab; active?: boolean }): ReactElement {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "error"; message: string }
  >({ status: "loading" });

  const url = state.status === "ready" ? state.url : null;
  const notifyActivity = () => {
    if (!url) return;
    iframe.current?.contentWindow?.postMessage({
      type: "maek:preview-activity", active: active && !document.hidden,
    }, new URL(url, location.href).origin);
  };
  useEffect(() => {
    notifyActivity();
    const ready = (event: MessageEvent) => {
      if (url && event.source === iframe.current?.contentWindow
        && event.origin === new URL(url, location.href).origin
        && event.data?.type === "maek:preview-ready") notifyActivity();
    };
    window.addEventListener("message", ready);
    document.addEventListener("visibilitychange", notifyActivity);
    return () => {
      window.removeEventListener("message", ready);
      document.removeEventListener("visibilitychange", notifyActivity);
    };
  }, [active, url]);

  useEffect(() => {
    let cancelled = false;
    let mountId: string | null = null;
    const workspace = useStore.getState().workspace;
    setState({ status: "loading" });
    void api<CustomPageMountResult>("/api/custom-pages/mount", "POST", {
      entry: tab.id,
    }, workspace).then(
      (result) => {
        if (result.kind === "custom-page") mountId = result.mountId;
        if (cancelled) {
          if (mountId)
            void api(`/api/custom-pages/mount/${mountId}`, "DELETE", undefined, workspace).catch(
              () => {},
            );
          return;
        }
        setState({
          status: "ready",
          url:
            result.kind === "custom-page"
              ? customPageUrl(result.mountPath)
              : artifactUrl(tab.id),
        });
      },
      (error) => {
        if (!cancelled) setState({ status: "error", message: String(error) });
      },
    );
    return () => {
      cancelled = true;
      if (mountId)
        void api(`/api/custom-pages/mount/${mountId}`, "DELETE", undefined, workspace).catch(
          () => {},
        );
    };
  }, [tab.id, tab.generation, tab.previewNonce, attempt]);

  if (state.status === "loading")
    return <div className="flex-1 min-h-0 flex items-center justify-center text-muted-text">Loading page…</div>;
  if (state.status === "error")
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-muted-text">
        <p role="alert">{state.message}</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
      </div>
    );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <iframe
        ref={iframe}
        key={`${state.url}:${tab.generation}:${tab.previewNonce}`}
        title={tab.name}
        src={state.url}
        onLoad={notifyActivity}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
        className="flex-1 min-h-0 w-full border-0 bg-white"
      />
    </div>
  );
}
