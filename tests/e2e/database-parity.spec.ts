import { test, expect } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-parity-"));
  mkdirSync(path.join(root, "Projects"));
  const schema = [
    {
      id: "status",
      name: "Status",
      type: "select",
      order: 0,
      options: ["Todo", "Done"],
    },
    { id: "date", name: "Date", type: "date", order: 1 },
    { id: "period", name: "Period", type: "date-range", order: 2 },
    { id: "text", name: "Notes", type: "text", order: 3 },
  ];
  const views = ["table", "kanban", "calendar", "timeline"].map((type) => ({
    id: type,
    name: type[0]!.toUpperCase() + type.slice(1),
    type,
    config: {
      sort: [],
      filter: { combinator: "and", conditions: [] },
      groupColumnId: "status",
      dateColumnId: type === "timeline" ? "period" : "date",
      zoom: "week",
    },
    createdAt: 1,
    updatedAt: 1,
  }));
  writeFileSync(
    path.join(root, "Projects/.maek-database.json"),
    JSON.stringify({
      version: 1,
      type: "database",
      id: "projects",
      name: "Projects",
      schema,
      views,
      activeViewId: "table",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  writeFileSync(
    path.join(root, "Projects/Task A.md"),
    "---\nStatus: Todo\nDate: 2026-09-16\nPeriod:\n  start: 2026-09-14\n  end: 2026-09-18\nNotes: Original\n---\n\n# Body stays here.\n",
  );
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));

test('popup body edits preserve database frontmatter and derived views', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Enter folder path', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Workspace path' }).fill(root);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await page.getByText('Task A', { exact: true }).first().hover();
  await page.getByRole('button', { name: 'Open in center peek' }).click();

  const dialog = page.getByRole('dialog', { name: 'Database note' });
  await dialog.locator('.tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Saved from popup.');
  await page.getByRole('button', { name: 'Close note' }).click();

  await expect.poll(() => readFileSync(path.join(root, 'Projects/Task A.md'), 'utf8'))
    .toContain('Saved from popup.');
  const saved = readFileSync(path.join(root, 'Projects/Task A.md'), 'utf8');
  expect(saved).toContain('Status: Todo');
  expect(saved).toContain('Period:\n  start: 2026-09-14\n  end: 2026-09-18');

  await page.getByRole('button', { name: 'Kanban', exact: true }).click();
  await expect(page.getByText('Todo', { exact: true })).toBeVisible();
  await expect(page.getByText('Task A', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  const kanbanEditor = page.locator('textarea').last();
  await kanbanEditor.fill('Edited from Kanban');
  await kanbanEditor.press('Enter');
  await expect.poll(() => readFileSync(path.join(root, 'Projects/Task A.md'), 'utf8'))
    .toContain('Notes: Edited from Kanban');
  const kanbanSaved = readFileSync(path.join(root, 'Projects/Task A.md'), 'utf8');
  expect(kanbanSaved).toContain('Status: Todo');
  expect(kanbanSaved).toContain('Period:\n  start: 2026-09-14\n  end: 2026-09-18');
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText('1 scheduled', { exact: true })).toBeVisible();
});

test("desktop database views, popup editing, and Home", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await expect(page.getByText("Task A", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "/tmp/maek-table.png" });
  await page.getByText("Task A", { exact: true }).first().hover();
  await page.getByRole("button", { name: "Open in center peek" }).click();
  await expect(
    page.getByRole("dialog", { name: "Database note" }),
  ).toBeVisible();
  await page.getByRole("dialog").locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Saved from popup.");
  await page.getByRole("button", { name: "Close note" }).click();
  await expect
    .poll(() => readFileSync(path.join(root, "Projects/Task A.md"), "utf8"))
    .toContain("Saved from popup.");
  const savedPopupNote = readFileSync(path.join(root, "Projects/Task A.md"), "utf8");
  expect(savedPopupNote).toContain("Status: Todo");
  expect(savedPopupNote).toContain("Period:\n  start: 2026-09-14\n  end: 2026-09-18");
  for (const name of ["Kanban", "Calendar", "Timeline", "Table"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(
        () =>
          JSON.parse(
            readFileSync(
              path.join(root, "Projects/.maek-database.json"),
              "utf8",
            ),
          ).activeViewId,
      )
      .toBe(name.toLowerCase());
    await page.screenshot({ path: `/tmp/maek-${name.toLowerCase()}.png` });
  }
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(page.getByText("Todo", { exact: true })).toBeVisible();
  await expect(page.getByText("Task A", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByText("1 scheduled", { exact: true })).toBeVisible();
  for (const name of ["Kanban", "Calendar", "Timeline"]) {
    await page.getByRole("button", { name, exact: true }).click();
    if (name === "Kanban") {
      await page.getByText("Task A", { exact: true }).first().hover();
      await page.getByRole("button", { name: "Open in center peek" }).click();
    } else {
      await page.getByRole("button", { name: "Task A", exact: true }).first().click();
    }
    const dialog = page.getByRole("dialog", { name: "Database note" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".tiptap")).toContainText("Body stays here.");
    await page.getByRole("button", { name: "Close note" }).click();
    await expect(dialog).toBeHidden();
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start writing", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/maek-home.png" });
  expect(errors).toEqual([]);
});

test("database popup fills the dialog through the scrollbar and heading rail", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await page.getByText("Task A", { exact: true }).first().hover();
  await page.getByRole("button", { name: "Open in center peek" }).click();

  const dialog = page.getByRole("dialog", { name: "Database note" });
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const pane = element.querySelector<HTMLElement>(".maek-editor-pane");
    const scroll = element.querySelector<HTMLElement>(".maek-editor-scroll");
    const rail = element.querySelector<HTMLElement>(".maek-heading-rail");
    if (!pane || !scroll || !rail) throw new Error("Editor layout is incomplete");
    return {
      dialogRight: element.getBoundingClientRect().right,
      paneRight: pane.getBoundingClientRect().right,
      scrollRight: scroll.getBoundingClientRect().right,
      railRight: rail.getBoundingClientRect().right,
    };
  });

  expect(geometry.dialogRight - geometry.paneRight).toBeLessThanOrEqual(2);
  expect(geometry.paneRight - geometry.scrollRight).toBeLessThanOrEqual(1);
  expect(geometry.dialogRight - geometry.railRight).toBeLessThanOrEqual(20);
});

for (const empty of [false, true]) {
  test(`timeline focuses today after delayed initial rows (${empty ? 'empty' : 'past dates'})`, async ({ page }) => {
    const manifestPath = path.join(root, 'Projects/.maek-database.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.activeViewId = 'timeline';
    manifest.views.find((view: { id: string }) => view.id === 'timeline').config.zoom = 'month';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const rowPath = path.join(root, 'Projects/Task A.md');
    const rowContent = '---\nPeriod:\n  start: 2020-01-01\n  end: 2020-01-03\nNotes: Original\n---\n';
    if (empty) rmSync(rowPath);
    else writeFileSync(rowPath, rowContent);

    let releaseRows!: () => void;
    const rowsReady = new Promise<void>((resolve) => { releaseRows = resolve; });
    await page.route('**/api/databases/command', async (route) => {
      if (route.request().postDataJSON().action === 'sync') await rowsReady;
      await route.continue();
    });
    await page.goto('/');
    await page.getByText('Enter folder path', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Workspace path' }).fill(root);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('[data-path="Projects"]').click();
    const scroller = page.getByTestId('timeline-scroll');
    try {
      await expect(scroller).toBeVisible();
      await expect(page.getByText('Month', { exact: true })).toBeVisible();
    } finally {
      releaseRows();
    }
    await expect(page.getByText(`${empty ? 0 : 1} scheduled`, { exact: true })).toBeVisible();
    await expect.poll(() => scroller.evaluate((element) => {
      const today = element.querySelector<HTMLElement>('[data-testid="timeline-today-line"]')!;
      // The marker includes half a day (4px at Month zoom).
      return Math.abs(today.getBoundingClientRect().left - element.getBoundingClientRect().left - element.clientWidth / 3 - 4);
    })).toBeLessThan(2);

    if (!empty) {
      const panned = await scroller.evaluate((element) => {
        element.scrollLeft -= 160;
        return element.scrollLeft;
      });
      const refreshed = page.waitForResponse((response) =>
        response.url().endsWith('/api/databases/command') && response.request().postDataJSON().action === 'sync');
      writeFileSync(rowPath, rowContent.replace('Original', 'Updated'));
      await refreshed;
      await expect(scroller).toHaveJSProperty('scrollLeft', panned);
      await page.getByRole('button', { name: 'Today', exact: true }).click();
      await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(panned);
    }
  });
}

test("timeline pans horizontally and fills the viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();

  const scroller = page.locator('[data-testid="timeline-scroll"]');
  await expect(page.getByRole("button", { name: "Task A", exact: true })).toBeVisible();
  const before = await scroller.evaluate((element) => ({
    left: element.scrollLeft,
    width: element.clientWidth,
    contentWidth: element.scrollWidth,
  }));
  expect(before.contentWidth - before.width).toBeGreaterThan(200);

  await page.getByRole("button", { name: "Task A", exact: true }).hover();
  await page.mouse.wheel(150, 0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before.left);

  const afterRight = await scroller.evaluate((element) => element.scrollLeft);
  await page.mouse.wheel(-150, 0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeLessThan(afterRight);

  await page.getByRole("button", { name: "Zoom out" }).click();
  const monthRange = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(monthRange).toBeGreaterThan(200);

  const gridGeometry = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="timeline-scroll"]');
    const body = document.querySelector<HTMLElement>('[data-testid="timeline-grid-body"]');
    const todayLine = document.querySelector<HTMLElement>('[data-testid="timeline-today-line"]');
    if (!scroller || !body || !todayLine) throw new Error("Timeline grid is incomplete");
    return {
      viewportBottom: scroller.getBoundingClientRect().bottom,
      bodyBottom: body.getBoundingClientRect().bottom,
      todayLineBottom: todayLine.getBoundingClientRect().bottom,
    };
  });
  expect(gridGeometry.bodyBottom).toBeGreaterThanOrEqual(gridGeometry.viewportBottom - 2);
  expect(gridGeometry.todayLineBottom).toBeGreaterThanOrEqual(gridGeometry.viewportBottom - 2);
});

test("keeps the Home label when a workspace rename arrives", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const dashboard = page.getByRole("tab", { name: "Home", exact: true });
  await expect(dashboard).toBeVisible();
  renameSync(path.join(root, "Projects/Task A.md"), path.join(root, "Projects/Renamed.md"));
  await expect(dashboard).toBeVisible();
  await expect(page.getByRole("tab", { name: /maek:virtual:dashboard/i })).toHaveCount(0);
});

test("inline text and select editing, keyboard kanban drag, and external changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await page.locator("table textarea").fill("First line\nSecond line");
  await page.locator("table textarea").press("ControlOrMeta+Enter");
  await expect
    .poll(() => readFileSync(path.join(root, "Projects/Task A.md"), "utf8"))
    .toContain("Second line");
  await page.getByRole("button", { name: "Todo", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(() => readFileSync(path.join(root, "Projects/Task A.md"), "utf8"))
    .toContain("Status: Done");
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  const drag = page.getByRole("button", { name: "Drag card" });
  await drag.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect
    .poll(() => readFileSync(path.join(root, "Projects/Task A.md"), "utf8"))
    .not.toContain("Status:");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const file = path.join(root, "Projects/Task A.md");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("Second line", "Changed outside"),
  );
  await expect(
    page.getByRole("button", { name: /Changed outside/ }),
  ).toBeVisible();
});

test("failed popup save keeps the draft open", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator('[data-path="Projects"]').click();
  await page.getByText("Task A", { exact: true }).hover();
  await page.getByRole("button", { name: "Open in center peek" }).click();
  const dialog = page.getByRole("dialog", { name: "Database note" });
  await dialog.locator(".tiptap").click();
  await page.route("**/api/files/content", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            message: "External edit conflict",
            error: "conflict",
          }),
        })
      : route.continue(),
  );
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Keep this draft");
  await page.getByRole("button", { name: "Close note" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Keep this draft");
  await expect(dialog.getByRole("alert")).toContainText(
    "External edit conflict",
  );
  // A conflict must remain explicit; closing must not silently discard the draft.
  expect(
    readFileSync(path.join(root, "Projects/Task A.md"), "utf8"),
  ).not.toContain("Keep this draft");
});
