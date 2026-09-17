import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-v1-e2e-"));
  mkdirSync(path.join(root, "Folder"));
  writeFileSync(
    path.join(root, "Folder", "기존 노트.md"),
    "---\ncustom: keep-me\n---\n\n# Original\n\nExisting paragraph.\n",
  );
  writeFileSync(path.join(root, "readme.txt"), "Plain text preview");
  writeFileSync(
    path.join(root, "index.html"),
    `<h1>Rendered HTML</h1>
     <p id="data">Loading</p>
     <button id="action">Run action</button>
     <a href="linked.html" target="_blank">Open linked page</a>
     <script>
       fetch("artifact-data.json").then((response) => response.json()).then((data) => {
         document.querySelector("#data").textContent = data.message;
       });
       document.querySelector("#action").addEventListener("click", () => {
         document.querySelector("#action").textContent = "Action ran";
       });
     </script>`,
  );
  writeFileSync(
    path.join(root, "artifact-data.json"),
    JSON.stringify({ message: "Artifact data loaded" }),
  );
  writeFileSync(path.join(root, "linked.html"), "<h1>Linked artifact page</h1>");
  writeFileSync(path.join(root, "data.db"), "\0binary");
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));
async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
}
function webSessionFile(name: string) {
  const sessionsRoot = path.join(root, ".maek/sessions/web");
  if (!existsSync(sessionsRoot)) return null;
  const sessionId = readdirSync(sessionsRoot)[0];
  if (!sessionId) return null;
  const file = path.join(sessionsRoot, sessionId, name);
  return existsSync(file) ? file : null;
}
/** The shared open-tab list lives in the workspace-root version-4 document. */
function rootTabsDocument(): { tabs: { id: string }[]; activeTabId: string | null } | null {
  const file = path.join(root, ".maek/tabs.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
async function editNote(page: Page) {
  await page.locator('[data-path="Folder"]').click();
  await page.locator('[data-path="Folder/기존 노트.md"]').click();
  await expect(page.locator(".tiptap")).toBeVisible();
}
test("save dots stay visible beside Open Tabs and the hovered note until save completes", async ({ page }) => {
  await open(page);
  await editNote(page);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/files/content", async (route) => {
    if (route.request().method() === "PUT") await saveGate;
    await route.continue();
  });
  try {
    await page.locator(".tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Save indicator regression");
    const row = page.locator('[data-tab-id="Folder/기존 노트.md"]');
    const summary = page.getByTestId("open-tabs-save-status");
    await expect(summary).toBeVisible();
    await row.hover();
    await expect(row.getByLabel("Saving", { exact: true })).toBeVisible();
    await expect(summary).toHaveAttribute("aria-label", "Saving");
    await expect(summary).toHaveCSS("background-color", "rgb(192, 78, 62)");
    await expect(row.getByLabel("Saving", { exact: true })).toHaveCSS("background-color", "rgb(192, 78, 62)");
    await page.getByText("Open Tabs", { exact: true }).click();
    await expect(summary).toBeVisible();
    releaseSave();
    await expect(summary).toHaveCount(0);
    await page.getByText("Open Tabs", { exact: true }).click();
    await expect(row.locator('[aria-label="Saving"], [aria-label="Unsaved"]')).toHaveCount(0);
  } finally {
    releaseSave();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("opens an app database and switches across all four web views", async ({ page }) => {
  const now = Date.now();
  const schema = [
    { id: "status", name: "Status", type: "select", order: 0, options: ["To Do", "Done"] },
    { id: "date", name: "Date", type: "date", order: 1 },
    { id: "period", name: "Period", type: "date-range", order: 2 },
  ];
  const views = [
    { id: "table", name: "Table", type: "table", config: { sort: [], filter: { combinator: "and", conditions: [] } }, createdAt: now, updatedAt: now },
    { id: "board", name: "Board", type: "kanban", config: { groupColumnId: "status", sort: [], filter: { combinator: "and", conditions: [] } }, createdAt: now, updatedAt: now },
    { id: "calendar", name: "Calendar", type: "calendar", config: { dateColumnId: "date", sort: [], filter: { combinator: "and", conditions: [] } }, createdAt: now, updatedAt: now },
    { id: "timeline", name: "Timeline", type: "timeline", config: { dateColumnId: "period", zoom: "week", sort: [], filter: { combinator: "and", conditions: [] } }, createdAt: now, updatedAt: now },
  ];
  mkdirSync(path.join(root, "Tasks"));
  writeFileSync(path.join(root, "Tasks/.maek-database.json"), JSON.stringify({ version: 1, type: "database", id: "tasks", name: "Tasks", schema, views, activeViewId: "table", createdAt: now, updatedAt: now }));
  writeFileSync(path.join(root, "Tasks/First.md"), "---\nStatus: To Do\nDate: 2026-09-15\nPeriod:\n  start: 2026-09-15\n  end: 2026-09-17\n---\n\n# First\n");
  await open(page);
  await page.locator('[data-path="Tasks"]').click();
  await expect(page.getByText("Tasks", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByText("To Do", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("September 2026")).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("1 scheduled", {exact:true})).toBeVisible();
});

test("Show in file tree reveals a deeply nested note with mounted and unmounted collapsed trees", async ({ page }) => {
  mkdirSync(path.join(root, "Folder", "Deep", "Nested"), { recursive: true });
  for (let i = 0; i < 70; i++) writeFileSync(path.join(root, "Folder", `aaa-${i}.md`), "# Filler");
  writeFileSync(path.join(root, "Folder", "Deep", "Nested", "target.md"), "# Target");
  await open(page);
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("textbox", { name: "Search files", exact: true }).fill("target");
  await page.getByRole("option").filter({ hasText: "target" }).click();
  const row = page.locator('[data-tab-id="Folder/Deep/Nested/target.md"]');
  const target = page.locator('[data-path="Folder/Deep/Nested/target.md"]');
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in file tree", exact: true }).click();
  await expect(target).toBeInViewport();
  await expect(target.locator("xpath=ancestor::*[@role='treeitem']")).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-path="Folder"]').scrollIntoViewIfNeeded();
  await page.locator('[data-path="Folder"]').click();
  await page.getByText("Files", { exact: true }).click();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in file tree", exact: true }).click();
  await expect(target).toBeInViewport();
  await expect(target.locator("xpath=ancestor::*[@role='treeitem']")).toHaveAttribute("aria-selected", "true");
});

test("shows folder icons stored by the desktop app", async ({ page }) => {
  mkdirSync(path.join(root, ".maek"), { recursive: true });
  writeFileSync(
    path.join(root, ".maek/folder-appearance.json"),
    JSON.stringify({
      version: 1,
      folders: { Folder: { icon: "rocket", iconColor: "blue" } },
    }),
  );

  await open(page);

  await expect(
    page.locator('[data-path="Folder"] svg.lucide-rocket'),
  ).toBeVisible();
});

test("opens existing nested notes, edits with Tiptap, restores session and theme", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await editNote(page);
  expect(
    readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"),
  ).toContain("custom: keep-me");
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.type(" 한국어 편집");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("한국어 편집");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(
      () => {
        const ui = webSessionFile("ui.json");
        if (!ui) return undefined;
        return JSON.parse(readFileSync(ui, "utf8")).theme;
      },
    )
    .toBe("dark");
  await page.screenshot({ path: "test-results/v1-editor-dark.png" });
  await page.reload();
  await expect(page.locator(".tiptap")).toContainText("한국어 편집");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(readdirSync(root).sort()).toEqual(
    [
      ".maek",
      "Folder",
      "artifact-data.json",
      "data.db",
      "index.html",
      "readme.txt",
    ].sort(),
  );
  expect(errors).toEqual([]);
});
test("external watcher updates files and protects dirty edits", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# External\n\nFresh content",
  );
  await expect(page.locator(".tiptap")).toContainText("Fresh content");
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Unsaved local");
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# Other editor\n\nDisk version",
  );
  await expect(page.getByRole("alert")).toContainText(
    /externally|changed|바뀌/,
  );
  await page.waitForTimeout(1700);
  expect(
    readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"),
  ).toContain("Disk version");
  await expect(page.locator(".tiptap")).toContainText("Unsaved local");
  writeFileSync(path.join(root, "outside.md"), "# Added");
  await expect(page.locator('[data-path="outside.md"]')).toBeVisible();
});
test("search, read-only preview, unsupported file and native picker cancel", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/api/workspaces/pick", (route) => {
    expect(route.request().headers()["content-type"]).toBeUndefined();
    return route.fulfill({ json: { status: "canceled" } });
  });
  await page.getByRole("button", { name: "Open Folder", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Open your workspace" }),
  ).toBeVisible();
  await open(page);
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("textbox", { name: "Search files" }).fill("readme");
  await page.getByRole("option").first().click();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  await page.locator('[data-path="index.html"]').click();
  const artifact = page.frameLocator('iframe[title="index.html"]');
  await expect(artifact.locator("#data")).toHaveText("Artifact data loaded");
  await artifact.getByRole("button", { name: "Run action" }).click();
  await expect(artifact.getByRole("button", { name: "Action ran" })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await artifact.getByRole("link", { name: "Open linked page" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Linked artifact page" })).toBeVisible();
  await popup.close();
  const browserPagePromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open in browser" }).click();
  const browserPage = await browserPagePromise;
  await expect(browserPage.getByRole("heading", { name: "Rendered HTML" })).toBeVisible();
  expect(new URL(browserPage.url()).pathname).toContain("/_web/");
  await browserPage.close();
  await page.locator('[data-path="data.db"]').click();
  await expect(
    page.getByText("Unsupported file format", { exact: true }),
  ).toBeVisible();
});

test("non-markdown files use the compact file toolbar and markdown keeps the large title", async ({
  page,
}) => {
  writeFileSync(path.join(root, "table.csv"), "name,score\nyoon,100\n");
  await open(page);

  // HTML shows the compact toolbar (an editable "File name" field) instead of a
  // large 3xl heading, and does not repeat the file name inside the preview.
  await page.locator('[data-path="index.html"]').click();
  const htmlName = page.getByRole("textbox", { name: "File name" });
  await expect(htmlName).toHaveValue("index");
  await expect(page.getByLabel("Reload HTML preview")).toBeVisible();
  await expect(page.getByLabel("Open in browser")).toBeVisible();

  // Image, PDF-less text and CSV also surface a file name in the toolbar. The
  // text preview toolbar hides the reload button (first version).
  await page.locator('[data-path="readme.txt"]').click();
  await expect(page.getByRole("textbox", { name: "File name" })).toHaveValue(
    "readme",
  );
  await expect(page.getByLabel("Reload HTML preview")).toHaveCount(0);

  // CSV opens the spreadsheet editor with the compact toolbar file name.
  await page.locator('[data-path="table.csv"]').click();
  await expect(page.getByRole("textbox", { name: "File name" })).toHaveValue(
    "table",
  );

  // Every toolbar action is reachable by its accessible name.
  await page.locator('[data-path="index.html"]').click();
  for (const label of [
    "File name",
    "Reload HTML preview",
    "Open in browser",
    "Open file to the side",
  ]) {
    await expect(page.getByLabel(label).first()).toBeVisible();
  }

  // Icon-only actions use the portal tooltip, so the hint is not clipped by
  // the compact toolbar or misplaced at the viewport edge.
  await page.getByRole("button", { name: "Open in browser" }).hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("Open in browser");
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1000);

  // Markdown keeps the existing large editor title (no "File name" field).
  await editNote(page);
  await expect(page.getByRole("textbox", { name: "File name" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy note" })).toBeVisible();
});

test("renames an HTML file from the toolbar and preserves the extension", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="index.html"]').click();
  const field = page.getByRole("textbox", { name: "File name" });
  await expect(field).toHaveValue("index");

  // Commit a rename with Enter; the .html extension is preserved.
  await field.fill("renamed");
  await field.press("Enter");
  await expect
    .poll(() => existsSync(path.join(root, "renamed.html")))
    .toBe(true);
  await expect(page.getByRole("textbox", { name: "File name" })).toHaveValue(
    "renamed",
  );

  // Escape reverts an in-progress edit without renaming.
  const field2 = page.getByRole("textbox", { name: "File name" });
  await field2.fill("scrapped");
  await field2.press("Escape");
  await expect(field2).toHaveValue("renamed");
  expect(existsSync(path.join(root, "scrapped.html"))).toBe(false);
  expect(existsSync(path.join(root, "renamed.html"))).toBe(true);
});

test("reload resets a mutated HTML artifact to its initial state", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="index.html"]').click();
  const artifact = page.frameLocator('iframe[title="index.html"]');
  await artifact.getByRole("button", { name: "Run action" }).click();
  await expect(
    artifact.getByRole("button", { name: "Action ran" }),
  ).toBeVisible();

  await page.getByLabel("Reload HTML preview").click();
  // The iframe is recreated, so the button returns to its initial label.
  await expect(artifact.getByRole("button", { name: "Run action" })).toBeVisible();
});

test("split HTML panes reload independently and the right pane can open in browser", async ({
  page,
}) => {
  writeFileSync(
    path.join(root, "second.html"),
    `<h1>Second artifact</h1>
     <button id="b">Second action</button>
     <script>document.querySelector("#b").addEventListener("click", () => { document.querySelector("#b").textContent = "Second ran"; });</script>`,
  );
  await open(page);
  await page.locator('[data-path="index.html"]').click();

  // Open the second HTML file in the split (right) pane.
  await page.getByLabel("Open file to the side").click();
  await page.getByRole("textbox", { name: "Search files" }).fill("second");
  await page.getByRole("option").filter({ hasText: "second" }).first().click();

  const right = page.frameLocator('iframe[title="second.html"]');
  await expect(right.getByRole("button", { name: "Second action" })).toBeVisible();

  // Mutate the right pane, then reload the LEFT pane. The right iframe must not
  // be recreated, so its mutated state survives.
  await right.getByRole("button", { name: "Second action" }).click();
  await expect(right.getByRole("button", { name: "Second ran" })).toBeVisible();

  const leftReload = page.getByLabel("Reload HTML preview").first();
  await leftReload.click();
  await expect(right.getByRole("button", { name: "Second ran" })).toBeVisible();

  // The right pane's own Open in browser action works.
  const reloadButtons = page.getByLabel("Reload HTML preview");
  await expect(reloadButtons).toHaveCount(2);
  const browserButtons = page.getByLabel("Open in browser");
  await expect(browserButtons).toHaveCount(2);
  const browserPagePromise = page.waitForEvent("popup");
  await browserButtons.nth(1).click();
  const browserPage = await browserPagePromise;
  await expect(
    browserPage.getByRole("heading", { name: "Second artifact" }),
  ).toBeVisible();
  expect(new URL(browserPage.url()).pathname).toContain("/_web/");
  await browserPage.close();
});

test("explorer separates creation from object context actions", async ({ page }) => {
  await open(page);

  const addNew = page.getByLabel("Add new");
  await addNew.hover();
  await expect(page.getByRole("menuitem", { name: "New note", exact: true })).toHaveCount(0);
  await addNew.click();
  await expect(page.getByRole("menuitem", { name: "New note", exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.locator('[data-path="Folder"]').click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "New CSV", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "New database", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /^Database/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Turn into database", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Reveal in Finder", exact: true })).toHaveCount(1);
});

test.skip("creates and edits a CSV spreadsheet with undo and autosave", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="Folder"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "New CSV", exact: true }).click();
  await expect(page.getByRole("grid", { name: "Untitled.csv" })).toBeVisible();

  const firstCell = page.locator('.rdg-cell[role="gridcell"]:not(.csv-row-number)').first();
  await firstCell.dblclick();
  const editor = page.locator(".csv-cell-editor");
  await editor.fill("한국어 데이터");
  await editor.press("Enter");
  await expect(firstCell).toContainText("한국어 데이터");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(firstCell).not.toContainText("한국어 데이터");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(firstCell).toContainText("한국어 데이터");

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await firstCell.click();
  await page.evaluate(() => navigator.clipboard.writeText("이름\t점수\n윤철\t100"));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByRole("gridcell").filter({ hasText: "점수" })).toBeVisible();

  await expect.poll(() => readFileSync(path.join(root, "Folder/Untitled.csv"), "utf8")).toBe("이름,점수\n윤철,100");
});

test("rename, duplicate, move and delete use the tree and real paths", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page
    .locator('[data-path="Folder/기존 노트.md"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "File name" });
  await input.fill("Renamed.md");
  await input.press("Enter");
  await expect(page.locator('[data-path="Folder/Renamed.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="Folder/Renamed.md"]')).toBeVisible();
  await page
    .locator('[data-path="Folder/Renamed.md"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.locator('[data-path="Folder/Renamed 2.md"]')).toBeVisible();
  await page
    .locator('[data-path="Folder/Renamed 2.md"]')
    .dragTo(page.locator('[data-path="Folder"]'), {
      targetPosition: { x: 5, y: 14 },
    });
  // External move uses inode pairing, including an open tab.
  renameSync(path.join(root, "Folder/Renamed.md"), path.join(root, "Moved.md"));
  await expect(page.locator('[data-path="Moved.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="Moved.md"]')).toBeVisible();
  await expect(page.locator(".tiptap")).toContainText("Original");
  // Mock the destructive OS boundary but exercise the actual UI request.
  let deleted: string[] = [];
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleted = route.request().postDataJSON().paths;
    for (const p of deleted) rmSync(path.join(root, p));
    return route.fulfill({ json: { ok: true } });
  });
  await page.locator('[data-path="Moved.md"]').click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to Trash", exact: true })
    .click();
  const trashDialog = page.getByRole("dialog", { name: "Move to Trash?" });
  await expect(trashDialog).toContainText("Moved.md");
  await trashDialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect.poll(() => deleted).toEqual(["Moved.md"]);
  await expect(page.locator('[data-path="Moved.md"]')).toHaveCount(0);
});

test("original slash menu, table, math, image and frontmatter work in Tiptap", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(page.locator(".maek-slash-menu")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tiptap table")).toHaveCount(1);
  const file = path.join(root, "rich.md");
  writeFileSync(
    file,
    "# Rich\n\n## Editor features\n\n### Details\n\n- [ ] Task\n\n$$\nx^2\n$$\n\n```js\nconst x = 1\n```\n",
  );
  await expect(page.locator('[data-path="rich.md"]')).toBeVisible();
  await page.locator('[data-path="rich.md"]').click();
  await expect(page.locator('.tiptap input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator(".tiptap .katex")).toBeVisible();
  await expect(page.locator(".tiptap-code-block")).toBeVisible();
  const headingRail = page.getByRole("navigation", {
    name: "Document headings",
  });
  await expect(headingRail).toBeVisible();
  await headingRail.hover();
  await expect(
    headingRail.getByText("Editor features", { exact: true }),
  ).toBeVisible();
  await expect(headingRail.getByText("Details", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      headingRail.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(180);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".tiptap img")).toBeVisible();
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain(".maek/assets/pixel.png");
  await page.screenshot({ path: "test-results/v1-editor-light.png" });
});

test("switching tabs during a delayed save preserves the latest edit", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page.route("**/api/files/content", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  const area = page.locator(".tiptap");
  await area.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" First edit");
  await page.keyboard.press("ControlOrMeta+s");
  await page.keyboard.type(" Latest edit");
  await page.locator('[data-path="readme.txt"]').click();
  await page.locator('[data-tab-id="Folder/기존 노트.md"]').click();
  await expect(area).toContainText("Latest edit");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("Latest edit");
});

test("opening and switching an untouched note never rewrites its Markdown", async ({
  page,
}) => {
  const file = path.join(root, "Folder/기존 노트.md");
  const original = readFileSync(file, "utf8");
  const mtime = statSync(file).mtimeMs;
  await open(page);
  await editNote(page);
  await page.waitForTimeout(1800); // Cross the autosave debounce without editing.
  await page.locator('[data-path="readme.txt"]').click();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  await expect
    .poll(
      () => {
        const ui = webSessionFile("ui.json");
        return ui ? JSON.parse(readFileSync(ui, "utf8")).activeTabId : null;
      },
    )
    .toBe("readme.txt");
  await page.reload();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(statSync(file).mtimeMs).toBe(mtime);
});

test("original note picker inserts encoded links and opens literal-percent filenames", async ({
  page,
}) => {
  writeFileSync(path.join(root, "Target %20 노트.md"), "# Linked target\n");
  await open(page);
  await editNote(page);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[[");
  await page.getByPlaceholder("Search notes...").fill("Target");
  await page.getByPlaceholder("Search notes...").press("Enter");
  const link = page.locator(".tiptap a.maek-note-link");
  await expect(link).toHaveAttribute(
    "href",
    "../Target%20%2520%20%EB%85%B8%ED%8A%B8.md",
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("%2520");
  await link.click();
  await expect(page.locator(".tiptap")).toContainText("Linked target");
  await expect(
    page.locator('[data-tab-id="Target %20 노트.md"]'),
  ).toBeVisible();
});

async function expectLatestLinkOpenToWin(
  page: Page,
  openLink: (link: Locator) => Promise<void>,
) {
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# Source\n\n[Open target](../target.md)\n",
  );
  writeFileSync(path.join(root, "earlier.md"), "# Earlier request\n");
  writeFileSync(path.join(root, "target.md"), "# Latest link target\n");

  let releaseEarlier!: () => void;
  let markEarlierRequested!: () => void;
  let markEarlierFinished!: () => void;
  const earlierGate = new Promise<void>((resolve) => {
    releaseEarlier = resolve;
  });
  const earlierRequested = new Promise<void>((resolve) => {
    markEarlierRequested = resolve;
  });
  const earlierFinished = new Promise<void>((resolve) => {
    markEarlierFinished = resolve;
  });

  await page.route("**/api/files/content?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      requestUrl.searchParams.get("path") === "earlier.md"
    ) {
      markEarlierRequested();
      await earlierGate;
      await route.continue();
      markEarlierFinished();
      return;
    }
    await route.continue();
  });

  try {
    await open(page);
    await editNote(page);

    await page.locator('[data-path="earlier.md"]').click();
    await earlierRequested;
    await openLink(page.locator(".tiptap a.maek-note-link"));

    const targetTab = page.locator('[data-tab-id="target.md"]');
    await expect(page.locator(".tiptap")).toContainText("Latest link target");
    await expect(targetTab).toHaveAttribute("aria-selected", "true");

    releaseEarlier();
    await earlierFinished;
    await expect(page.locator('[data-tab-id="earlier.md"]')).toBeVisible();
    await expect(page.locator(".tiptap")).toContainText("Latest link target");
    await expect(targetTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/note\/target\.md$/);
  } finally {
    releaseEarlier();
    await page.unrouteAll({ behavior: "wait" });
  }
}

test("a slower earlier file open cannot replace the latest note link target", async ({
  page,
}) => {
  await expectLatestLinkOpenToWin(page, async (link) => {
    await link.click();
  });
});

test("the note-link hover action keeps the latest target active", async ({
  page,
}) => {
  await expectLatestLinkOpenToWin(page, async (link) => {
    await link.hover();
    const hoverMenu = page.locator(".maek-link-hover-menu");
    await expect(hoverMenu).toBeVisible();
    await hoverMenu.getByRole("button", { name: "Open", exact: true }).click();
  });
});

test("a delayed side-pane open cannot steal focus from a newer tab selection", async ({
  page,
}) => {
  writeFileSync(path.join(root, "side-target.md"), "# Side target\n");
  writeFileSync(path.join(root, "latest.md"), "# Latest selection\n");

  let releaseSide!: () => void;
  let markSideRequested!: () => void;
  let markSideFinished!: () => void;
  const sideGate = new Promise<void>((resolve) => {
    releaseSide = resolve;
  });
  const sideRequested = new Promise<void>((resolve) => {
    markSideRequested = resolve;
  });
  const sideFinished = new Promise<void>((resolve) => {
    markSideFinished = resolve;
  });

  await page.route("**/api/files/content?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      requestUrl.searchParams.get("path") === "side-target.md"
    ) {
      markSideRequested();
      await sideGate;
      await route.continue();
      markSideFinished();
      return;
    }
    await route.continue();
  });

  try {
    await open(page);
    await editNote(page);
    await page.locator('[data-path="latest.md"]').click();
    await page.locator('[data-tab-id="Folder/기존 노트.md"]').click();

    await page.getByTitle("Open File to the Side…").click();
    await page.getByRole("textbox", { name: "Search files" }).fill("side-target");
    await page.getByRole("option").filter({ hasText: "side-target" }).click();
    await sideRequested;

    const latestTab = page.locator('[data-tab-id="latest.md"]');
    await latestTab.dispatchEvent("click");
    await expect(latestTab).toHaveAttribute("aria-selected", "true");

    releaseSide();
    await sideFinished;
    const editors = page.locator(".maek-editor-pane .tiptap");
    await expect(editors).toHaveCount(2);
    await expect(editors.nth(0)).toContainText("Latest selection");
    await expect(editors.nth(1)).toContainText("Side target");
    await expect(latestTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/note\/latest\.md$/);
  } finally {
    releaseSide();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("opens a new tree note while tabs restored from .maek remain open", async ({
  page,
}) => {
  writeFileSync(path.join(root, "second.md"), "# Second note\n");
  await open(page);
  await editNote(page);
  await expect
    .poll(() => rootTabsDocument()?.tabs.filter(t=>path.basename(t.id)!==".maek").length ?? 0)
    .toBe(1);
  await page.reload();
  await expect(
    page.locator('[data-tab-id="Folder/기존 노트.md"]'),
  ).toBeVisible();
  await page.locator('[data-path="second.md"]').click();
  await expect(page.locator('[data-tab-id="second.md"]')).toBeVisible();
  await expect(page.locator(".tiptap")).toContainText("Second note");
  await expect(page.locator('[role="tab"]')).toHaveCount(3); // Includes the shared dashboard.
});

test("tree click uses one replaceable preview and double click pins it", async ({
  page,
}) => {
  writeFileSync(path.join(root, "second.md"), "# Second note\n");
  writeFileSync(path.join(root, "third.md"), "# Third note\n");
  await open(page);

  const first = page.locator('[data-path="Folder/기존 노트.md"]');
  await page.locator('[data-path="Folder"]').click();
  await first.click();
  await expect(page.locator('[data-tab-id="Folder/기존 노트.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="Folder/기존 노트.md"]')).toHaveClass(/italic/);

  await page.locator('[data-path="second.md"]').click();
  await expect(page.locator('[data-tab-id="Folder/기존 노트.md"]')).toHaveCount(0);
  await expect(page.locator('[data-tab-id="second.md"]')).toHaveClass(/italic/);

  await page.locator('[data-path="second.md"]').dblclick();
  await expect(page.locator('[data-tab-id="second.md"]')).not.toHaveClass(/italic/);

  await page.locator('[data-path="third.md"]').click();
  await expect(page.locator('[data-tab-id="second.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="third.md"]')).toHaveClass(/italic/);
});

/** Basenames of web-managed tabs in root .maek/tabs.json order. */
function rootTabOrder(): string[] {
  const doc = rootTabsDocument();
  if (!doc) return [];
  return doc.tabs.filter(t=>path.basename(t.id)!==".maek").map((t) => path.basename(t.id));
}
/**
 * Absolute id in the form the server stores it — the workspace root is
 * realpath-resolved, so external writes must match that to be recognised.
 */
function noteId(relative: string): string {
  return path.join(realpathSync(root), relative);
}

/**
 * Drives the same pointer gesture as a user. `toBottomHalf` drops onto the lower
 * half of the target row (insertion after it).
 */
async function dragTab(
  page: Page,
  fromId: string,
  toId: string,
  toBottomHalf = true,
) {
  const from = page.locator(`[data-tab-id="${fromId}"]`);
  const to = page.locator(`[data-tab-id="${toId}"]`);
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error("drag target missing");
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height * (toBottomHalf ? 0.75 : 0.25),
    { steps: 5 },
  );
  await page.mouse.up();
}

async function openThreeNotes(page: Page) {
  writeFileSync(path.join(root, "one.md"), "# One\n");
  writeFileSync(path.join(root, "two.md"), "# Two\n");
  writeFileSync(path.join(root, "three.md"), "# Three\n");
  await expect(page.locator('[data-path="one.md"]')).toBeVisible();
  for (const name of ["one.md", "two.md", "three.md"]) {
    await page.locator(`[data-path="${name}"]`).click();
    await expect(page.locator(`[data-tab-id="${name}"]`)).toBeVisible();
  }
  // Wait for the client to flush the open-tab list to the shared root document
  // before any external edit races the initial persist.
  await expect
    .poll(() => rootTabOrder())
    .toEqual(["one.md", "two.md", "three.md"]);
}

test("reorders open notes in the sidebar and persists the root document order", async ({
  page,
}) => {
  await open(page);
  await openThreeNotes(page);
  await expect
    .poll(() => rootTabOrder())
    .toEqual(["one.md", "two.md", "three.md"]);

  // Drag the first note below the last one. Targeting the bottom half of the
  // last row places the insertion point at the end of the list.
  await dragTab(page, "one.md", "three.md", true);

  await expect
    .poll(() => rootTabOrder())
    .toEqual(["two.md", "three.md", "one.md"]);

  // The order survives a reload, restored from the shared document.
  await page.reload();
  await expect(page.locator('[data-tab-id="one.md"]')).toBeVisible();
  const ids = await page.locator('[data-tab-id]:not([data-tab-id="maek:virtual:dashboard"])').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-tab-id")),
  );
  expect(ids).toEqual(["two.md", "three.md", "one.md"]);
});

test("live-updates the open-note list when the root document changes externally", async ({
  page,
}) => {
  await open(page);
  await openThreeNotes(page);
  await page.locator('[data-tab-id="two.md"]').click();

  // The desktop app rewrites the shared document: reorder and add a note.
  writeFileSync(path.join(root, "four.md"), "# Four\n");
  writeFileSync(
    path.join(root, ".maek/tabs.json"),
    JSON.stringify({
      version: 4,
      tabs: [
        { id: noteId("three.md"), viewKind: "editor" },
        { id: noteId("two.md"), viewKind: "editor" },
        { id: noteId("one.md"), viewKind: "editor" },
        { id: noteId("four.md"), viewKind: "editor" },
      ],
      activeTabId: noteId("one.md"),
    }),
  );

  await expect(page.locator('[data-tab-id="four.md"]')).toBeVisible();
  await expect
    .poll(async () =>
      page.locator('[data-tab-id]:not([data-tab-id="maek:virtual:dashboard"])').evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-tab-id")),
      ),
    )
    .toEqual(["three.md", "two.md", "one.md", "four.md"]);
  // The active tab is preserved because it was not removed externally.
  await expect(page.locator('[data-tab-id="two.md"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("selects a neighbour only when the active note is removed externally", async ({
  page,
}) => {
  await open(page);
  await openThreeNotes(page);
  await page.locator('[data-tab-id="two.md"]').click();

  // Remove the active note (two.md) from the shared document.
  writeFileSync(
    path.join(root, ".maek/tabs.json"),
    JSON.stringify({
      version: 4,
      tabs: [
        { id: noteId("one.md"), viewKind: "editor" },
        { id: noteId("three.md"), viewKind: "editor" },
      ],
      activeTabId: noteId("one.md"),
    }),
  );

  await expect(page.locator('[data-tab-id="two.md"]')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.locator('[data-tab-id]:not([data-tab-id="maek:virtual:dashboard"])').evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-tab-id")),
      ),
    )
    .toEqual(["one.md", "three.md"]);
  // A neighbour becomes active because the previous selection is gone.
  await expect(page.locator('[data-tab-id="one.md"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("keeps a desktop-only tab in the document but hidden after a web reorder", async ({
  page,
}) => {
  // Meeting tabs remain desktop-only; database tabs are now shared.
  writeFileSync(path.join(root, "one.md"), "# One\n");
  writeFileSync(path.join(root, "two.md"), "# Two\n");
  mkdirSync(path.join(root, ".maek"), { recursive: true });
  writeFileSync(
    path.join(root, ".maek/tabs.json"),
    JSON.stringify({
      version: 4,
      tabs: [
        { id: noteId("sheet"), viewKind: "meeting", keep: "yes" },
        { id: noteId("one.md"), viewKind: "editor" },
        { id: noteId("two.md"), viewKind: "editor" },
      ],
      activeTabId: noteId("one.md"),
    }),
  );
  await open(page);
  // The meeting tab never appears in the web sidebar.
  await expect(page.locator('[data-tab-id="one.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="two.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="sheet"]')).toHaveCount(0);

  // Reorder the two web notes; the desktop-only tab must survive on disk.
  await dragTab(page, "one.md", "two.md", true);
  await expect
    .poll(() => rootTabOrder())
    .toEqual(["sheet", "two.md", "one.md"]);
  await expect
    .poll(() => {
      const doc = rootTabsDocument();
      return doc
        ? doc.tabs.find((t) => t.id === noteId("sheet"))
        : undefined;
    })
    .toMatchObject({ viewKind: "meeting", keep: "yes" });
});

test("saves an unsaved note before honouring an external close", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await expect.poll(() => rootTabOrder()).toEqual(["기존 노트.md"]);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Pending edit");

  // The note is externally removed from the shared document while dirty.
  writeFileSync(
    path.join(root, ".maek/tabs.json"),
    JSON.stringify({ version: 4, tabs: [], activeTabId: null }),
  );

  // The pending edit is flushed to disk, then the tab closes.
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("Pending edit");
  await expect(
    page.locator('[data-tab-id="Folder/기존 노트.md"]'),
  ).toHaveCount(0);
});

test("keeps an externally-closed note open when its save conflicts", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await expect.poll(() => rootTabOrder()).toEqual(["기존 노트.md"]);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Local only");

  // A conflicting external write makes the save fail with a 409.
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# Disk wins\n\nConflicting content",
  );
  writeFileSync(
    path.join(root, ".maek/tabs.json"),
    JSON.stringify({ version: 4, tabs: [], activeTabId: null }),
  );

  // The tab stays open with the local edit preserved and an error shown.
  await expect(page.getByRole("alert")).toContainText(
    /externally|changed|unsaved|conflict|바뀌/,
  );
  await expect(page.locator(".tiptap")).toContainText("Local only");
  await expect(
    page.locator('[data-tab-id="Folder/기존 노트.md"]'),
  ).toBeVisible();
});
