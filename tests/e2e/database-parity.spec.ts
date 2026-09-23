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
test("desktop database views, popup editing, and shared dashboard", async ({
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
  await page.getByRole("tab", { name: "Home Close Home" }).click();
  await expect(
    page.getByText("Maek Workspace Settings", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Shared dashboard description");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(path.join(root, ".maek/config.json"), "utf8"))
          .description,
    )
    .toBe("Shared dashboard description");
  await page.screenshot({ path: "/tmp/maek-dashboard.png" });
  await page
    .getByRole("button", { name: "Clear Saved Tabs", exact: true })
    .click();
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(path.join(root, ".maek/tabs.json"), "utf8"))
          .tabs,
    )
    .toEqual([]);
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
  const dashboard = page.getByRole("tab", { name: "Home Close Home" });
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
