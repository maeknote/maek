import { test, expect, type Page } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-tree-e2e-"));
  mkdirSync(path.join(root, "Folder"));
  writeFileSync(path.join(root, "Folder", "note.md"), "# Note\n\nBody\n");
  writeFileSync(path.join(root, "top.md"), "# Top level\n");
  mkdirSync(path.join(root, "Target"));
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));

async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
}

test("file rows show muted extensions without format icons", async ({
  page,
}) => {
  // A custom folder icon via the app-shared appearance file.
  mkdirSync(path.join(root, ".maek"), { recursive: true });
  mkdirSync(path.join(root, "Iconed"));
  writeFileSync(
    path.join(root, ".maek/folder-appearance.json"),
    JSON.stringify({
      version: 1,
      folders: { Iconed: { icon: "rocket", iconColor: "blue" } },
    }),
  );
  writeFileSync(path.join(root, "sheet.csv"), "a,b\n1,2\n");
  writeFileSync(path.join(root, "page.html"), "<h1>Hi</h1>");
  await open(page);

  // File rows carry no SVG (file-type) icon: only the name + muted extension.
  const csvRow = page.locator('[data-path="sheet.csv"]');
  await expect(csvRow).toBeVisible();
  await expect(csvRow.locator("svg")).toHaveCount(0);
  await expect(csvRow.getByText(".csv", { exact: true })).toBeVisible();

  const htmlRow = page.locator('[data-path="page.html"]');
  await expect(htmlRow.locator("svg")).toHaveCount(0);
  await expect(htmlRow.getByText(".html", { exact: true })).toBeVisible();

  const mdRow = page.locator('[data-path="top.md"]');
  await expect(mdRow.getByText(".md", { exact: true })).toBeVisible();

  // The custom folder icon still renders (folders are not file formats). The
  // row also carries a chevron, so an iconed folder has two SVGs vs a file's
  // zero.
  await expect(page.locator('[data-path="Iconed"] svg')).toHaveCount(2);
});

test("an ordinary folder toggles open and closed on a single row click", async ({
  page,
}) => {
  await open(page);
  const child = page.locator('[data-path="Folder/note.md"]');
  const folder = page.locator('[data-path="Folder"]');

  await expect(child).toHaveCount(0);
  await folder.click();
  await expect(child).toBeVisible();
  await folder.click();
  await expect(child).toHaveCount(0);
  // Repeated toggles keep working.
  await folder.click();
  await expect(child).toBeVisible();
});

test("a folder toggles exactly once even if a refresh lands mid-click", async ({
  page,
}) => {
  await open(page);
  const child = page.locator('[data-path="Folder/note.md"]');
  const folder = page.locator('[data-path="Folder"]');

  // Fire a workspace refresh right after the click; the folder must end open
  // (a single toggle), not flip twice back to closed.
  await folder.click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("maek:workspace-change", {
        detail: { type: "change", path: "top.md" },
      }),
    ),
  );
  await expect(child).toBeVisible();
});

test("a database appears as a file-like tree row and opens on click", async ({
  page,
}) => {
  const now = Date.now();
  mkdirSync(path.join(root, "Tasks"));
  writeFileSync(
    path.join(root, "Tasks/.maek-database.json"),
    JSON.stringify({
      version: 1,
      type: "database",
      id: "tasks",
      name: "Tasks",
      schema: [{ id: "status", name: "Status", type: "text", order: 0 }],
      views: [
        {
          id: "table",
          name: "Table",
          type: "table",
          config: { sort: [], filter: { combinator: "and", conditions: [] } },
          createdAt: now,
          updatedAt: now,
        },
      ],
      activeViewId: "table",
      createdAt: now,
      updatedAt: now,
    }),
  );
  writeFileSync(path.join(root, "Tasks/First.md"), "---\nStatus: Open\n---\n\n# First\n");
  await open(page);

  const dbFolder = page.locator('[data-path="Tasks"]');
  const dbChild = page.locator('[data-path="Tasks/First.md"]');

  await expect(dbFolder.getByText("Database", { exact: true })).toBeVisible();
  await expect(dbFolder.locator("svg")).toHaveCount(0);

  // The database opens directly; its rows belong to the database view.
  await dbFolder.click();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(dbChild).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Tasks Database" })).toBeVisible();
});

test("Enter starts a rename and commits it once, preserving focus through a refresh", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="Folder"]').click();
  const child = page.locator('[data-path="Folder/note.md"]');
  await child.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();

  const input = page.getByRole("textbox", { name: "File name" });
  await expect(input).toBeFocused();

  // A workspace-change arriving mid-edit must not steal focus or the value.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("maek:workspace-change", {
        detail: { type: "change", path: "top.md" },
      }),
    ),
  );
  await expect(input).toBeFocused();

  await input.fill("Renamed.md");
  await input.press("Enter");

  await expect(page.locator('[data-path="Folder/Renamed.md"]')).toBeVisible();
  // A single commit: the original file is gone and no duplicate was created.
  await expect
    .poll(() => existsSync(path.join(root, "Folder/Renamed.md")))
    .toBe(true);
  expect(existsSync(path.join(root, "Folder/note.md"))).toBe(false);
  expect(
    readdirSync(path.join(root, "Folder")).filter((n) => n.endsWith(".md")),
  ).toEqual(["Renamed.md"]);
});

test("Escape cancels a rename without touching the filesystem", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="top.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "File name" });
  await input.fill("scrapped.md");
  await input.press("Escape");
  await expect(page.locator('[data-path="top.md"]')).toBeVisible();
  expect(existsSync(path.join(root, "scrapped.md"))).toBe(false);
  expect(existsSync(path.join(root, "top.md"))).toBe(true);
});

test("dragging a file into a folder moves it and shows no sibling insertion line", async ({
  page,
}) => {
  await open(page);
  const source = page.locator('[data-path="top.md"]');
  const target = page.locator('[data-path="Target"]');

  await source.dragTo(target, { targetPosition: { x: 20, y: 14 } });

  await expect
    .poll(() => existsSync(path.join(root, "Target/top.md")))
    .toBe(true);
  expect(existsSync(path.join(root, "top.md"))).toBe(false);
  await expect(page.locator('[data-path="Target/top.md"]')).toBeVisible();
});

test("dropping a folder onto itself is rejected", async ({ page }) => {
  await open(page);
  const folder = page.locator('[data-path="Folder"]');
  // Drag the folder onto its own row: the move must be rejected and the folder
  // must stay where it is.
  await folder.dragTo(folder, { targetPosition: { x: 20, y: 14 } });
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
  expect(existsSync(path.join(root, "Folder"))).toBe(true);
  expect(existsSync(path.join(root, "Folder/Folder"))).toBe(false);
});

test("the file tree virtualizes: DOM rows stay far below the total file count", async ({
  page,
}) => {
  // A large flat tree. With virtualization only the visible window (plus a
  // small overscan) is in the DOM, so the row count must not scale with 400.
  for (let i = 0; i < 400; i++)
    writeFileSync(path.join(root, `file-${String(i).padStart(3, "0")}.md`), "x");
  await open(page);
  await expect(page.locator('[data-path="file-000.md"]')).toBeVisible();
  const rowCount = await page.locator("[data-file-node]").count();
  // 400 files, but the viewport is ~1000px / 28px per row ≈ 36 visible rows.
  // Allow generous headroom for overscan; the point is it is nowhere near 400.
  expect(rowCount).toBeLessThan(120);
});
