import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { EditorUiStateSchema, type EditorUiState } from "../../../shared/editor";
import { WorkspaceMetadataRepository } from "../../metadata/repository";
import { getWorkspace } from "../../workspaces";

export function registerEditorState(app: FastifyInstance, metadata: WorkspaceMetadataRepository,
  serial: <T>(key: string, fn: () => Promise<T>) => Promise<T>) {
  const target = (headers: Record<string, unknown>) => {
    const ws = getWorkspace(z.string().parse(headers["x-workspace-id"]));
    const profile = z.uuid().parse(headers["x-client-profile-id"]);
    return { ws, relative: `sessions/web/${profile}/editor.json` };
  };
  async function read(ws: ReturnType<typeof getWorkspace>, relative: string): Promise<EditorUiState> {
    try {
      return EditorUiStateSchema.parse(JSON.parse(await readFile(await metadata.path(ws, relative), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { collapsedHeadings: {} };
      if (error instanceof SyntaxError || error instanceof z.ZodError) return { collapsedHeadings: {} };
      throw error;
    }
  }
  app.get("/api/workspace/editor-state", async (req) => {
    const { ws, relative } = target(req.headers);
    return serial(`${ws.root}:${relative}`, () => read(ws, relative));
  });
  app.put("/api/workspace/editor-state", async (req) => {
    const { ws, relative } = target(req.headers);
    const patch = EditorUiStateSchema.parse(req.body);
    return serial(`${ws.root}:${relative}`, async () => {
      const state = await read(ws, relative);
      // Merge note patches under the lock so two windows editing different
      // notes never replace each other's presentation state.
      for (const [note, keys] of Object.entries(patch.collapsedHeadings)) {
        if (keys.length) state.collapsedHeadings[note] = keys;
        else delete state.collapsedHeadings[note];
      }
      EditorUiStateSchema.parse(state);
      await metadata.writeJson(ws, relative, state);
      return state;
    });
  });
}
