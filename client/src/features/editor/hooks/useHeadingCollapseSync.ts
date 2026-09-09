import { useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useHeadingCollapseStore } from "../stores/headingCollapseStore";
import {
  buildDocumentHeadingKeyMap,
  resolveKeysToPositions,
} from "../extensions/heading/headingKeys";
import { HEADING_TOGGLE_PLUGIN_KEY } from "../extensions/heading";

export function useHeadingCollapseSync(
  editor: TiptapEditor | null,
  tabId: string,
): void {
  const restoredRef = useRef(false);
  const prevPositionsRef = useRef<number[] | null>(null);

  // Restore collapsed state on editor ready
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    restoredRef.current = false;

    const restore = (): void => {
      if (restoredRef.current) return;
      restoredRef.current = true;

      const keys = useHeadingCollapseStore.getState().getCollapsed(tabId);
      if (keys.length === 0) return;

      const positions = resolveKeysToPositions(editor.state.doc, keys);
      if (positions.length === 0) return;

      editor.view.dispatch(
        editor.state.tr.setMeta(HEADING_TOGGLE_PLUGIN_KEY, {
          type: "restore",
          collapsedHeadingPositions: positions,
        }),
      );
    };

    // Restore after a frame to ensure editor is fully initialized
    const frameId = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frameId);
  }, [editor, tabId]);

  // Sync plugin state changes to Zustand store
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handleTransaction = (): void => {
      const pluginState = HEADING_TOGGLE_PLUGIN_KEY.getState(editor.state);
      const positions = pluginState?.collapsedHeadingPositions ?? [];

      // Skip if positions haven't changed
      if (prevPositionsRef.current === positions) return;
      prevPositionsRef.current = positions;

      if (positions.length === 0) {
        useHeadingCollapseStore.getState().setCollapsed(tabId, []);
        return;
      }

      const keyMap = buildDocumentHeadingKeyMap(editor.state.doc);
      const keys: string[] = [];
      for (const pos of positions) {
        const key = keyMap.get(pos);
        if (key) keys.push(key);
      }

      useHeadingCollapseStore.getState().setCollapsed(tabId, keys);
    };

    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor, tabId]);
}
