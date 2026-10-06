import { useEffect, useRef, useState } from "react";
import { useStore } from "@renderer/features/workspace";
import { ViewerToolbar } from "@renderer/features/editor";
import { useDatabaseRegistry } from "./registryQuery";
import { databaseApi } from "./api";
import { DatabaseViewContainer } from "./DatabaseViewContainer";
import { useWorkspaceStore } from "./workspaceStore";
import { navigate, parseRoute, workspaceKeyFor } from "../../lib/routes";
export function DatabaseView({ folderPath }: { folderPath: string }) {
  const workspace = useStore((s) => s.workspace);
  const registry = useDatabaseRegistry();
  const [routeError, setRouteError] = useState("");
  const appliedRoute = useRef<string>("");
  useEffect(() => {
    if (!registry.data || !workspace) return;
    const key = `${workspace.wsId}:${folderPath}`;
    if (appliedRoute.current === key) return;
    const route = parseRoute();
    const database = registry.data.find(item => item.folderPath === folderPath);
    if (!database) return;
    appliedRoute.current = key;
    if (route?.kind !== "folder" || route.path !== folderPath) return;
    const requested = route.viewId
      ? database.views.find(view => view.id === route.viewId)
      : database.views.find(view => view.type === (route.view === "board" ? "kanban" : route.view));
    if (requested && requested.id !== database.activeViewId)
      void databaseApi.databaseSetActiveView(workspace.root, database.id, requested.id)
        .catch(error => setRouteError(String(error)));
  }, [workspace, folderPath, registry.data]);
  const ready = registry.isSuccess;
  const error = routeError || (registry.error ? String(registry.error) : "");
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
  const rename = async (name: string) => {
    const dest = [...folderPath.split("/").slice(0, -1), name].join("/");
    try {
      await useStore.getState().move(folderPath, dest);
    } catch (cause) {
      useStore.getState().setError(String(cause));
      throw cause;
    }
  };
  return (
    <div className="h-full min-w-0 min-h-0 flex flex-col">
      <ViewerToolbar
        tab={{ id: folderPath, name: meta.name }}
        onRename={rename}
        typeLabel="Database"
        nameLabel="Database name"
      />
      <div className="flex-1 min-h-0">
        <DatabaseViewContainer databaseFolderPath={folderPath} />
      </div>
    </div>
  );
}
