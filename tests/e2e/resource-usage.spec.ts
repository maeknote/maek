import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

let root: string;
const manifest = (id: string, name: string) => JSON.stringify({
  version: 1, type: "database", id, name, schema: [],
  views: [{ id: "table", type: "table", name: "Table", config: {}, createdAt: 1, updatedAt: 1 }],
  activeViewId: "table", createdAt: 1, updatedAt: 1,
});
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-resources-"));
  mkdirSync(path.join(root, "Board"));
  mkdirSync(path.join(root, "Outputs"));
  mkdirSync(path.join(root, "Project/.venv/FakeDB"), { recursive: true });
  writeFileSync(path.join(root, "Board/.maek-database.json"), manifest("board", "Board"));
  writeFileSync(path.join(root, "Project/.venv/FakeDB/.maek-database.json"), manifest("fake", "FakeDB"));
  writeFileSync(path.join(root, "note.md"), "# Note\n\nKeep editing.\n");
  writeFileSync(path.join(root, "page.html"), `<!doctype html><html><head><title>Activity</title></head><body>
    <button onclick="this.textContent='Changed'">Original</button>
    <script>window.ticks=0;setInterval(()=>window.ticks++,20);window.saved=false;
      setTimeout(()=>window.saved=true,1000);</script></body></html>`);
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));
test.use({ trace: "off" });

async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="Board"]').getByText("Database", { exact: true })).toBeVisible();
  await page.locator('[data-path="note.md"]').dblclick();
  await expect(page.locator(".tiptap")).toBeVisible();
}

test("a 1,000-file burst updates the tree without refetching unrelated data", async ({ page }) => {
  // Keep the starting index close to the investigated life-os workspace size.
  for (let i = 0; i < 9000; i++)
    writeFileSync(path.join(root, "Outputs", `existing_${String(i).padStart(4, "0")}.png`), "image");
  await open(page);
  await page.waitForTimeout(400); // Let the initial watcher rescan finish.
  let registryReads = 0;
  let treeReads = 0;
  let rowSyncs = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/databases") registryReads++;
    if (url.pathname === "/api/tree") treeReads++;
    if (url.pathname === "/api/databases/command" && request.postDataJSON()?.action === "sync") rowSyncs++;
  });
  const started = performance.now();
  for (let i = 0; i < 1000; i++)
    writeFileSync(path.join(root, "Outputs", `generated_${String(i).padStart(4, "0")}.png`), "image");
  await page.keyboard.press("ControlOrMeta+p");
  await expect(page.getByRole("listbox", { name: "Files" })).toBeVisible();
  expect(await page.getByRole("option").count()).toBeLessThan(20);
  await page.getByRole("textbox", { name: "Search files" }).fill("generated_0999");
  await expect(page.getByRole("option").filter({ hasText: "generated_0999" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".tiptap").click();
  await page.keyboard.press("End");
  await page.keyboard.type("Still responsive");
  await expect(page.locator(".tiptap")).toContainText("Still responsive");
  expect(registryReads).toBe(0);
  expect(treeReads).toBe(0);
  expect(rowSyncs).toBe(0);
  console.log(JSON.stringify({ initialGeneratedFiles: 9000, filesAdded: 1000, observedAndEditedMs: Math.round(performance.now() - started), registryReads, treeReads, rowSyncs }));
});

test("file picker keeps a bounded DOM while scrolling and navigating beyond its first rows", async ({ page }) => {
  for (let i = 0; i < 80; i++) writeFileSync(path.join(root, "Outputs", `entry_${String(i).padStart(2, "0")}.txt`), "Picker body");
  await open(page);
  await page.keyboard.press("ControlOrMeta+p");
  await expect(page.getByRole("listbox", { name: "Files" })).toBeVisible();
  expect(await page.getByRole("option").count()).toBeLessThan(20);
  for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowDown");
  await expect(page.locator('[role="option"][aria-selected="true"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("pre")).toHaveText("Picker body");
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("listbox", { name: "Files" }).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("option").filter({ hasText: "page" })).toBeVisible();
  expect(await page.getByRole("option").count()).toBeLessThan(20);
});

test("DB discovery tracks external creation, movement and manifest deletion", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-path*=".venv"]')).toHaveCount(0);
  mkdirSync(path.join(root, "NewBoard"));
  writeFileSync(path.join(root, "NewBoard/.maek-database.json"), manifest("new", "NewBoard"));
  await expect(page.locator('[data-path="NewBoard"]').getByText("Database", { exact: true })).toBeVisible();
  renameSync(path.join(root, "NewBoard"), path.join(root, "MovedBoard"));
  await expect(page.locator('[data-path="MovedBoard"]').getByText("Database", { exact: true })).toBeVisible();
  await expect(page.locator('[data-path="NewBoard"]')).toHaveCount(0);
  unlinkSync(path.join(root, "MovedBoard/.maek-database.json"));
  await expect(page.locator('[data-path="MovedBoard"]')).toBeVisible();
  await expect(page.locator('[data-path="MovedBoard"]').getByText("Database", { exact: true })).toHaveCount(0);
  // A hidden manifest renamed to an ordinary file must enter the visible tree.
  renameSync(path.join(root, "Board/.maek-database.json"), path.join(root, "manifest-backup.json"));
  await expect(page.locator('[data-path="manifest-backup.json"]')).toBeVisible();
  await expect(page.locator('[data-path="Board"]').getByText("Database", { exact: true })).toHaveCount(0);
  renameSync(path.join(root, "manifest-backup.json"), path.join(root, "Board/.maek-database.json"));
  await expect(page.locator('[data-path="manifest-backup.json"]')).toHaveCount(0);
  await expect(page.locator('[data-path="Board"]').getByText("Database", { exact: true })).toBeVisible();
});

test("registry changes during a slow request share it and reconcile the latest metadata", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="Board"]').click();
  await expect(page.getByRole("textbox", { name: "Database name" })).toHaveValue("Board");
  await page.waitForTimeout(400);
  let reads = 0;
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const firstRequest = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/databases", async route => {
    const number = ++reads;
    const response = await route.fetch();
    if (number === 1) { started(); await held; }
    await route.fulfill({ response });
  });
  const update = (name: string, updatedAt: number) => writeFileSync(
    path.join(root, "Board/.maek-database.json"),
    JSON.stringify({ ...JSON.parse(manifest("board", name)), updatedAt }),
  );
  try {
    update("First", 2);
    await firstRequest;
    update("Latest", 3);
    await page.waitForTimeout(250); // Cross the fixed refresh window while held.
    expect(reads).toBe(1);
  } finally { release(); }
  await expect(page.getByRole("textbox", { name: "Database name" })).toHaveValue("Latest");
  expect(reads).toBe(2);
});

test("inactive HTML pauses intervals, preserves state and does not block one-shot saves", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="page.html"]').dblclick();
  const frame = () => page.frames().find(item => item.parentFrame() && item.url().includes("page.html"));
  await expect.poll(() => Boolean(frame())).toBe(true);
  await expect.poll(() => frame()!.evaluate(() => (window as unknown as { ticks: number }).ticks)).toBeGreaterThan(2);
  await page.frameLocator('iframe[title="page.html"]').getByRole("button", { name: "Original" }).click();
  await page.locator('[data-tab-id="note.md"]').click();
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.waitForTimeout(80); // Activity is sent through postMessage.
  const paused = await frame()!.evaluate(() => (window as unknown as { ticks: number }).ticks);
  await page.waitForTimeout(200);
  expect(await frame()!.evaluate(() => (window as unknown as { ticks: number }).ticks)).toBe(paused);
  await expect.poll(() => frame()!.evaluate(() => (window as unknown as { saved: boolean }).saved)).toBe(true);
  await page.locator('[data-tab-id="page.html"]').click();
  await expect(page.frameLocator('iframe[title="page.html"]').getByRole("button", { name: "Changed" })).toBeVisible();
  await expect.poll(() => frame()!.evaluate(() => (window as unknown as { ticks: number }).ticks)).toBeGreaterThan(paused);
  await page.locator('[data-tab-id="note.md"]').click();
  await page.waitForTimeout(400); // Persist active selection before reloading.
  await page.reload();
  await expect(page.locator(".tiptap")).toBeVisible();
  await expect(page.locator('iframe[title="page.html"]')).toHaveCount(0);
  await page.locator('[data-tab-id="page.html"]').click();
  await expect(page.locator('iframe[title="page.html"]')).toBeVisible();
});
