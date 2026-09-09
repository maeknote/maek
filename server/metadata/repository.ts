import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Workspace } from "../workspaces";
import { workspaceTarget } from "../workspace/filesystem";

/**
 * Owns all workspace-scoped application metadata. Feature routes decide the
 * schema; this repository decides placement and atomic persistence.
 */
export class WorkspaceMetadataRepository {
  async path(workspace: Workspace, relativeName: string) {
    const directory = await workspaceTarget(workspace, ".maek");
    await mkdir(directory, { recursive: true });
    const config = await workspaceTarget(workspace, ".maek/config.json");
    try {
      await writeFile(
        config,
        JSON.stringify(
          { version: 1, name: workspace.name, createdAt: Date.now() },
          null,
          2,
        ),
        { flag: "wx" },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const absolutePath = await workspaceTarget(
      workspace,
      ".maek/" + relativeName,
    );
    await mkdir(path.dirname(absolutePath), { recursive: true });
    return absolutePath;
  }

  async writeJson(
    workspace: Workspace,
    relativeName: string,
    value: unknown,
  ) {
    const absolutePath = await this.path(workspace, relativeName);
    const temporaryPath = absolutePath + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporaryPath, JSON.stringify(value, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, absolutePath);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}
