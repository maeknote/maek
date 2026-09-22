import { useEffect, useState } from "react";
import { useStore } from "@renderer/features/workspace";
import { api } from "@renderer/shared/api";
import { databaseApi } from "./api";
import { DatabaseViewContainer } from "./DatabaseViewContainer";
import { useWorkspaceStore } from "./workspaceStore";
import type { DatabaseMeta } from "@shared/database";
import { navigate, parseRoute, workspaceKeyFor } from "../../lib/routes";
export function DatabaseView({ folderPath }: { folderPath: string }) {
  const workspace = useStore((s) => s.workspace);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;
    let timer: ReturnType<typeof setTimeout>;
    setReady(false);
    async function refresh() {
      try {
        const databases = await api<DatabaseMeta[]>(
          "/api/databases",
          "GET",
          undefined,
          workspace,
        );
        if (cancelled) return;
        useWorkspaceStore.setState({ rootPath: workspace?.root ?? null });
        useWorkspaceStore.getState().setDatabases(databases);
        if (firstLoad) {
          firstLoad = false;
          const route = parseRoute(),
            meta = databases.find((d) => d.folderPath === folderPath);
          if (
            meta &&
            workspace &&
            route?.kind === "folder" &&
            route.path === folderPath
          ) {
            const requested = route.viewId
              ? meta.views.find((v) => v.id === route.viewId)
              : meta.views.find(
                  (v) =>
                    v.type === (route.view === "board" ? "kanban" : route.view),
                );
            if (requested && requested.id !== meta.activeViewId)
              await databaseApi.databaseSetActiveView(
                workspace.root,
                meta.id,
                requested.id,
              );
          }
        }
        if (!cancelled) {
          setReady(true);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void refresh();
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 200);
    };
    window.addEventListener("maek:workspace-change", changed);
    window.addEventListener("focus", changed);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("maek:workspace-change", changed);
      window.removeEventListener("focus", changed);
    };
  }, [workspace, folderPath]);
  const meta = useWorkspaceStore((s) =>
    s.databases.find((d) => d.folderPath === folderPath),
  );
  useEffect(() => {
    if (!ready || !meta || !workspace) return;
    const view = meta.views.find((v) => v.id === meta.activeViewId);
    const route = parseRoute();
    if (view && (route?.kind !== "folder" || route.viewId !== view.id))
      navigate(
        {
          kind: "folder",
          workspaceKey: workspaceKeyFor(workspace.root),
          path: folderPath,
          view: view.type === "kanban" ? "board" : view.type,
          viewId: view.id,
        },
        true,
      );
  }, [ready, meta, workspace, folderPath]);
  if (error)
    return (
      <div role="alert" className="p-6 text-maek-red">
        {error}
      </div>
    );
  if (!ready)
    return <div className="p-6 text-muted-text">Loading database…</div>;
  if (!meta)
    return <div className="p-6 text-muted-text">Database not found.</div>;
  return (
    <div className="h-full min-w-0 min-h-0 flex flex-col">
      <div className="viewer-toolbar flex items-center gap-2 px-3 shrink-0">
        <span
          className="viewer-toolbar-filename flex-1 text-sm font-medium text-neutral-ink"
          title={folderPath || meta.name}
        >
          {meta.name}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <DatabaseViewContainer databaseFolderPath={folderPath} />
      </div>
    </div>
  );
}
