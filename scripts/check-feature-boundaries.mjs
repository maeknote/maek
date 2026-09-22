import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  }));
  return nested.flat();
}

function featureFrom(file, marker) {
  const suffix = file.split(marker)[1];
  return suffix?.split(path.sep)[0] ?? null;
}

export async function checkFeatureBoundaries() {
  const errors = [];
  const clientFeatures = path.join(root, "client/src/features");
  for (const file of await filesUnder(clientFeatures)) {
    const owner = featureFrom(file, `${path.sep}features${path.sep}`);
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      const target = specifier.match(/^@renderer\/features\/([^/]+)(?:\/(.+))?$/);
      if (!target || target[1] === owner) continue;
      if (target[2]) errors.push(`${path.relative(root, file)}: cross-feature import must use @renderer/features/${target[1]}`);
    }
  }

  const shared = path.join(root, "client/src/shared");
  for (const file of await filesUnder(shared)) {
    const content = await readFile(file, "utf8");
    if (/from\s+["']@renderer\/(?:features|app)(?:\/|["'])/.test(content))
      errors.push(`${path.relative(root, file)}: shared code cannot import app or features`);
  }

  const core = path.join(root, "server/core");
  try {
    for (const file of await filesUnder(core)) {
      const content = await readFile(file, "utf8");
      if (/from\s+["']\.\.\/features\//.test(content))
        errors.push(`${path.relative(root, file)}: server core cannot import features`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return errors;
}

const errors = await checkFeatureBoundaries();
if (errors.length) {
  console.error("Feature boundary violations:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Feature boundaries: OK");
}
