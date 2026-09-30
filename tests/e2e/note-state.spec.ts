import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitFrontmatterFile, parseYamlData } from "../../shared/frontmatter";

let root: string;
const note = "---\nStatus: Todo\nNotes: Original\nCount: 1\n---";
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-note-state-"));
  mkdirSync(path.join(root, "Board"));
  const schema = [
    { id: "status", name: "Status", type: "select", order: 0, options: ["Todo", "Done"] },
    { id: "notes", name: "Notes", type: "text", order: 1 },
    { id: "count", name: "Count", type: "number", order: 2 },
  ];
  const views = ["kanban", "table"].map(type => ({
    id: type, type, name: type === 'kanban' ? 'Kanban' : 'Table',
    config: { groupColumnId: "status", sort: [], filter: { combinator: "and", conditions: [] } },
    createdAt: 1, updatedAt: 1,
  }));
  writeFileSync(path.join(root, "Board/.maek-database.json"), JSON.stringify({
    version: 1, type: "database", id: "board", name: "Board", schema, views,
    activeViewId: "kanban", createdAt: 1, updatedAt: 1,
  }));
  writeFileSync(path.join(root, "Board/Task.md"), note);
  writeFileSync(path.join(root, "headings.md"), "# First\n\nFirst content.\n\n# Second\n\nSecond content.\n");
  writeFileSync(path.join(root, "other.md"), "# Other\n\nContent.\n");
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));
async function open(page: Page) {
  await page.goto("/");
  const remembered = await page.evaluate(() => localStorage.getItem('maek:workspace'));
  if (!remembered) {
    await page.getByText("Enter folder path", { exact: true }).click();
    await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
    await page.getByRole("button", { name: "Open", exact: true }).click();
  }
  await expect(page.locator('[data-path="headings.md"]')).toBeVisible();
}
async function popup(page: Page) {
  await open(page);
  await page.locator('[data-path="Board"]').click();
  await page.getByText("Task", { exact: true }).first().hover();
  await page.getByRole("button", { name: "Open in center peek" }).click();
  const dialog = page.getByRole("dialog", { name: "Database note" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Show properties" }).click();
  return dialog;
}
const values = (file = "Task.md") => parseYamlData(splitFrontmatterFile(readFileSync(path.join(root, "Board", file), "utf8")).frontmatterRaw);

test("popup first body, sequential property edits, Cmd+S and Enter rename retain YAML", async ({ page }) => {
  const dialog = await popup(page);
  await dialog.locator('.tiptap').fill('First body added from popup.');
  await dialog.locator('.tiptap').press('ControlOrMeta+s');
  await expect.poll(() => splitFrontmatterFile(readFileSync(path.join(root, 'Board/Task.md'), 'utf8')).body)
    .toContain('First body added from popup.');
  const notes = dialog.getByRole('group', { name: 'Notes', exact: true }).getByRole('textbox').last();
  await notes.fill('First property edit');
  await notes.press('ControlOrMeta+s');
  const count = dialog.getByRole('group', { name: 'Count', exact: true }).getByRole('textbox').last();
  await count.fill('42');
  await count.press('ControlOrMeta+s');
  await expect.poll(() => values()).toMatchObject({ Status: 'Todo', Notes: 'First property edit', Count: 42 });
  const title = dialog.getByRole('textbox', { name: 'File name' });
  await title.fill('Renamed');
  await title.press('Enter');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => existsSync(path.join(root, 'Board/Renamed.md'))).toBe(true);
  expect(values('Renamed.md')).toMatchObject({ Status: 'Todo', Notes: 'First property edit', Count: 42 });
  expect(splitFrontmatterFile(readFileSync(path.join(root, 'Board/Renamed.md'), 'utf8')).body).toContain('First body');
  await page.getByText('Renamed', { exact: true }).first().hover();
  await page.getByRole('button', { name: 'Open in center peek' }).click();
  await expect(page.getByRole('dialog').locator('.tiptap')).toContainText('First body');
  await expect(page.getByRole('dialog').locator('.tiptap')).not.toContainText('Status:');
  await page.getByRole('button', { name: 'Close note' }).click();
});

test("Enter confirms a property name and immediate close saves its value", async ({ page }) => {
  const dialog = await popup(page);
  const group = dialog.getByRole('group', { name: 'Notes', exact: true });
  await group.getByRole('textbox', { name: 'Property name' }).fill('Description');
  await group.getByRole('textbox', { name: 'Property name' }).press('Enter');
  const count = dialog.getByRole('group', { name: 'Count', exact: true }).getByRole('textbox').last();
  await count.fill('27');
  await count.press('Enter');
  await dialog.getByRole('button', { name: 'Close note' }).click();
  await expect(dialog).toBeHidden();
  expect(values()).toEqual({ Status: 'Todo', Description: 'Original', Count: 27 });
});

test("heading collapse survives tab recreation and a new browser session", async ({ page, browser }) => {
  await open(page);
  await page.locator('[data-path="headings.md"]').dblclick();
  await page.getByRole('button', { name: 'Collapse section', exact: true }).first().click();
  await expect(page.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
  await page.locator('[data-path="other.md"]').dblclick();
  await page.locator('[data-tab-id="headings.md"]').click();
  await expect(page.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
  const profile = await page.evaluate(() => localStorage.getItem('maek:browser-profile'));
  await expect.poll(() => {
    const file = path.join(root, '.maek/sessions/web', profile!, 'editor.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).collapsedHeadings['headings.md'] : null;
  }).toEqual(['h1:First:0']);
  const state = await page.context().storageState();
  const context = await browser.newContext({ storageState: state });
  const restarted = await context.newPage();
  try {
    await open(restarted);
    await restarted.locator('[data-path="headings.md"]').dblclick();
    await expect(restarted.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
    const sibling = await page.context().newPage();
    await open(sibling);
    await sibling.locator('[data-path="headings.md"]').dblclick();
    await expect(sibling.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Expand section', exact: true }).click();
    await expect(sibling.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(0);
    await sibling.close();
  } finally { await context.close(); }
});

test("heading state follows a note rename, persists after tab close, and keeps duplicate headings separate", async ({ page }) => {
  writeFileSync(path.join(root, "headings.md"), "# Same\n\nFirst content.\n\n# Same\n\nSecond content.\n");
  await open(page);
  await page.locator('[data-path="headings.md"]').dblclick();
  await page.getByRole('button', { name: 'Collapse section', exact: true }).nth(1).click();
  const title = page.getByRole('textbox', { name: 'File name' });
  await title.fill('renamed');
  await title.press('Enter');
  await expect(page.locator('[data-tab-id="renamed.md"]')).toBeVisible();
  await expect(page.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
  expect(await page.locator('.tiptap h1').nth(0).getByRole('button').getAttribute('data-state')).toBe('expanded');
  expect(await page.locator('.tiptap h1').nth(1).getByRole('button').getAttribute('data-state')).toBe('collapsed');
  await page.locator('[data-tab-id="renamed.md"]').getByRole('button', { name: 'Close renamed.md' }).click();
  await page.locator('[data-path="renamed.md"]').dblclick();
  await expect(page.locator('.maek-heading-toggle[data-state="collapsed"]')).toHaveCount(1);
  const profile = await page.evaluate(() => localStorage.getItem('maek:browser-profile'));
  await expect.poll(() => {
    const file = path.join(root, '.maek/sessions/web', profile!, 'editor.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).collapsedHeadings : null;
  }).toEqual({ 'renamed.md': ['h1:Same:1'] });
});
