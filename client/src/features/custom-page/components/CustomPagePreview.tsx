import { useEffect, useState, type ReactElement } from "react";
import type { CustomPageMountResult } from "@shared/custom-page";
import { api, artifactUrl, customPageUrl } from "@renderer/shared/api";
import { Button } from "@renderer/shared/components";
import type { Tab } from "@renderer/features/workspace";

/** Mounts a manifest-backed custom page and releases its server mount on exit. */
export function CustomPagePreview({ tab }: { tab: Tab }): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let mountId: string | null = null;
    setState({ status: "loading" });
    void api<CustomPageMountResult>("/api/custom-pages/mount", "POST", {
      entry: tab.id,
    }).then(
      (result) => {
        if (result.kind === "custom-page") mountId = result.mountId;
        if (cancelled) {
          if (mountId)
            void api(`/api/custom-pages/mount/${mountId}`, "DELETE").catch(
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
        void api(`/api/custom-pages/mount/${mountId}`, "DELETE").catch(
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
        key={`${state.url}:${tab.generation}:${tab.previewNonce}`}
        title={tab.name}
        src={state.url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
        className="flex-1 min-h-0 w-full border-0 bg-white"
      />
    </div>
  );
}
