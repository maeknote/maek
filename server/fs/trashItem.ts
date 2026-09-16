import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Use Foundation directly instead of scripting Finder. The server can be
// launched in the background, where Finder Apple Events are commonly denied
// or disconnected even though moving an item to Trash is otherwise allowed.
const trashScript = String.raw`
ObjC.import("Foundation");

function run(argv) {
  const source = $.NSURL.fileURLWithPath(argv[0]);
  const resultingUrl = Ref();
  const error = Ref();
  const success = $.NSFileManager.defaultManager
    .trashItemAtURLResultingItemURLError(source, resultingUrl, error);

  if (String(success) !== "true") {
    throw new Error("macOS could not move the item to Trash");
  }
}
`;

export async function trashItem(filePath: string): Promise<void> {
  if (process.platform !== "darwin")
    throw new Error("Moving files to Trash requires macOS");

  await run("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    trashScript,
    "--",
    filePath,
  ]);
}
