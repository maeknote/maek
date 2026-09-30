import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
// Tracing snapshots thousands of DOM nodes on every assertion and distorts
// the latency measurement. Functional tests above retain normal tracing.
test.use({ trace: 'off' });
for (const count of [100, 1000]) test(`cached view switches need no row sync (${count} notes)`, async ({ page }) => {
  test.setTimeout(90_000);
  for (let index = 1; index < count; index++)
    writeFileSync(path.join(root, 'Board', `Task ${String(index).padStart(4, '0')}.md`), note);
  await open(page);
  const initialStarted = performance.now();
  await page.locator('[data-path="Board"]').click();
  await expect(page.getByText('Task', { exact: true }).first()).toBeVisible();
  const initialDisplayMs = performance.now() - initialStarted;
  await page.waitForTimeout(600);
  let syncs = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/databases/command') && request.postDataJSON()?.action === 'sync') syncs++;
  });
  let release!: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/databases/command', async route => {
    if (route.request().postDataJSON().action === 'active-view') await saving;
    await route.continue();
  });
  const latestSaved = page.waitForResponse(response => response.url().endsWith('/api/databases/command')
    && response.request().postDataJSON().action === 'active-view' && response.request().postDataJSON().viewId === 'kanban');
  await page.getByRole('group', { name: 'Database views', exact: true }).getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New row', exact: true })).toBeVisible();
  await expect(page.getByText('Task', { exact: true }).first()).toBeVisible();
  await page.getByRole('group', { name: 'Database views', exact: true }).getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByText('Todo', { exact: true }).first()).toBeVisible();
  release();
  await latestSaved;
  const switches: number[] = [];
  for (let index = 0; index < 10; index++) {
    const name = index % 2 ? 'Kanban' : 'Table';
    // Time from the browser click through the next painted view. Running this
    // inside the page excludes Playwright's accessible-name scans over 1,000 cards.
    const elapsed = await page.evaluate(async viewName => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Database views"] button')]
        .find(element => element.textContent?.trim() === viewName);
      if (!button) throw new Error(`Missing view ${viewName}`);
      const started = performance.now();
      button.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - started;
    }, name);
    if (name === 'Table') await expect(page.locator('table').first()).toBeVisible();
    else await expect(page.locator('[data-rfd-droppable-id]').first()).toBeVisible();
    switches.push(elapsed);
  }
  await expect.poll(() => JSON.parse(readFileSync(path.join(root, 'Board/.maek-database.json'), 'utf8')).activeViewId).toBe('kanban');
  await page.waitForTimeout(600);
  expect(syncs).toBe(0);
  switches.sort((a, b) => a - b);
  console.log(JSON.stringify({ notes: count, initialDisplayMs: Math.round(initialDisplayMs),
    switchMedianMs: Math.round(switches[5]!), switchP95Ms: Math.round(switches[9]!) }));
});
