import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useStore } from "@renderer/features/workspace";
import { useHeadingCollapseStore } from "../stores/headingCollapseStore";
import { buildDocumentHeadingKeyMap, resolveKeysToPositions } from "../extensions/heading/headingKeys";
import { HEADING_TOGGLE_PLUGIN_KEY } from "../extensions/heading";

export function useHeadingCollapseSync(editor: TiptapEditor | null, path: string): void {
  const workspace = useStore((state) => state.workspace);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !workspace) return;
    let restoring = true;
    let lastKeys = "";
    function restore() {
      if (!editor || editor.isDestroyed) return;
      restoring = true;
      const keys = useHeadingCollapseStore.getState().byWorkspace[workspace!.root]?.[path] ?? [];
      editor.view.dispatch(editor.state.tr.setMeta(HEADING_TOGGLE_PLUGIN_KEY, {
        type: "restore", collapsedHeadingPositions: resolveKeysToPositions(editor.state.doc, keys),
      }));
      lastKeys = JSON.stringify(keys);
      restoring = false;
    }
    const frame = requestAnimationFrame(restore);
    const transaction = () => {
      if (restoring || editor.isDestroyed) return;
      const positions = HEADING_TOGGLE_PLUGIN_KEY.getState(editor.state)?.collapsedHeadingPositions ?? [];
      const keyMap = buildDocumentHeadingKeyMap(editor.state.doc);
      const keys = positions.map((pos) => keyMap.get(pos)).filter((key): key is string => key !== undefined);
      const serialized = JSON.stringify(keys);
      if (serialized === lastKeys) return;
      lastKeys = serialized;
      useHeadingCollapseStore.getState().setCollapsed(workspace, path, keys);
    };
    editor.on("transaction", transaction);
    const unsubscribe = useHeadingCollapseStore.subscribe((next, previous) => {
      const keys = next.byWorkspace[workspace.root]?.[path];
      if (!restoring && keys !== previous.byWorkspace[workspace.root]?.[path] && JSON.stringify(keys ?? []) !== lastKeys) restore();
    });
    return () => { cancelAnimationFrame(frame); unsubscribe(); editor.off("transaction", transaction); };
  }, [editor, path, workspace]);
}
