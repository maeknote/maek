import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

let root: string;

test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-view-e2e-"));
  // A long text file so its <pre> scroller has somewhere to scroll.
  writeFileSync(
    path.join(root, "long.txt"),
    Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n"),
  );
  writeFileSync(path.join(root, "other.md"), "# Other\n\nSecond note body.\n");
  // A CSV with enough rows to scroll the grid.
  writeFileSync(
    path.join(root, "data.csv"),
    "name,value\n" +
      Array.from({ length: 200 }, (_, i) => `row${i},${i}`).join("\n"),
  );
  writeFileSync(
    path.join(root, "page.html"),
    `<h1>Artifact</h1><button id="b">Click</button>
     <script>document.querySelector("#b").addEventListener("click",()=>{document.querySelector("#b").textContent="Clicked";});</script>`,
  );
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));

async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="long.txt"]')).toBeVisible();
}

test("a text view keeps its scroll position across tab switches", async ({ page }) => {
  await open(page);

  // Open the long text file (double-click pins it) and scroll its <pre>.
  await page.locator('[data-path="long.txt"]').dblclick();
  const pre = page.locator("pre");
  await expect(pre).toBeVisible();
  await pre.evaluate((el) => (el.scrollTop = 500));
  await expect.poll(() => pre.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);

  // Open another note, then switch back via the Open Tabs list.
  await page.locator('[data-path="other.md"]').dblclick();
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.locator('[data-tab-id="long.txt"]').click();

  // The same <pre> element was kept mounted, so its scrollTop survives.
  await expect
    .poll(() => page.locator("pre").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(400);
});

test("an HTML iframe keeps its mutated state across tab switches", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="page.html"]').dblclick();
  const frame = page.frameLocator('iframe[title="page.html"]');
  await frame.getByRole("button", { name: "Click" }).click();
  await expect(frame.getByRole("button", { name: "Clicked" })).toBeVisible();

  await page.locator('[data-path="other.md"]').dblclick();
  await expect(page.locator(".tiptap")).toBeVisible();
  await page.locator('[data-tab-id="page.html"]').click();

  // The iframe was never unmounted, so the mutated button text persists.
  await expect(
    page.frameLocator('iframe[title="page.html"]').getByRole("button", { name: "Clicked" }),
  ).toBeVisible();
});

test("closing and reopening a text tab resets runtime-only scroll state", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="long.txt"]').dblclick();
  const pre = page.locator("pre");
  await pre.evaluate((el) => (el.scrollTop = 500));
  await expect.poll(() => pre.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);

  // Close the tab (removes the cached view) then reopen from the tree.
  await page.locator('[data-tab-id="long.txt"]').getByLabel(/^Close/).click();
  await expect(page.locator('[data-tab-id="long.txt"]')).toHaveCount(0);
  await page.locator('[data-path="long.txt"]').dblclick();

  // A freshly mounted view starts at the top.
  await expect.poll(() => page.locator("pre").evaluate((el) => el.scrollTop)).toBe(0);
});

test("dragging the split separator resizes both panes and clamps at the limits", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="other.md"]').dblclick();

  // Open a second file to the side to enter split mode.
  await page.getByLabel("Open file to the side").click();
  await page.getByRole("textbox", { name: "Search files" }).fill("long");
  await page.getByRole("option").filter({ hasText: "long" }).first().click();

  const separator = page.getByRole("separator", { name: "Resize panes" });
  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute("aria-valuemin", "25");
  await expect(separator).toHaveAttribute("aria-valuemax", "75");

  const leftSlot = page.locator('[data-file-pane-slot="other.md"]');
  const startWidth = await leftSlot.evaluate((el) => el.getBoundingClientRect().width);

  // Drag the separator far to the left; the ratio clamps at 25%.
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 2000, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const clampedWidth = await leftSlot.evaluate((el) => el.getBoundingClientRect().width);
  expect(clampedWidth).toBeLessThan(startWidth);
  await expect(separator).toHaveAttribute("aria-valuenow", "25");

  // Keyboard resizing nudges the ratio back up in 2% steps.
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "27");
});

test("the restored split ratio is applied to the actual pane widths after reload", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-path="other.md"]').dblclick();
  await page.getByLabel("Open file to the side").click();
  await page.getByRole("textbox", { name: "Search files" }).fill("long");
  await page.getByRole("option").filter({ hasText: "long" }).first().click();

  const separator = page.getByRole("separator", { name: "Resize panes" });
  const box = (await separator.boundingBox())!;
  // Drag left toward ~30%.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const area = (await page.locator('[data-file-pane-slot="other.md"]').boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.05, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const ratioNow = await separator.getAttribute("aria-valuenow");
  expect(Number(ratioNow)).toBeLessThan(50);

  // Give autosave a beat, then reload and confirm the ratio is reapplied.
  await page.waitForTimeout(500);
  await page.reload();
  const restored = page.getByRole("separator", { name: "Resize panes" });
  await expect(restored).toBeVisible();
  await expect(restored).toHaveAttribute("aria-valuenow", ratioNow!);
});

test("a split workspace is one Open Tabs row and survives switching away", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="other.md"]').dblclick();
  await page.getByLabel("Open file to the side").click();
  await page.getByRole("textbox", { name: "Search files" }).fill("long");
  await page.getByRole("option").filter({ hasText: "long" }).first().click();

  const separator = page.getByRole("separator", { name: "Resize panes" });
  await expect(separator).toBeVisible();
  const splitRatio = await separator.getAttribute("aria-valuenow");
  await expect(page.getByRole("tab", { name: "Split view: other.md and long.txt" })).toBeVisible();

  // A regular open creates another workspace, rather than overwriting the
  // current split. Returning through Open Tabs restores the exact split.
  await page.locator('[data-path="page.html"]').dblclick();
  await expect(page.locator('iframe[title="page.html"]')).toBeVisible();
  await page.locator('[data-tab-id="other.md"]').click();

  await expect(page.locator('[data-file-pane-slot="other.md"]')).toBeVisible();
  await expect(page.locator('[data-file-pane-slot="long.txt"]')).toBeVisible();
  await expect(separator).toHaveAttribute("aria-valuenow", splitRatio!);
});
