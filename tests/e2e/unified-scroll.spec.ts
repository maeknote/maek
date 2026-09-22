import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// A 14-inch target viewport. The plan pins the unified-scroll behaviour to this
// size with many tabs and a large tree.
const VIEWPORT = { width: 1512, height: 850 };

// 500 top-level notes drive a tree far taller than the viewport, and 30 of them
// are opened as tabs so Open Tabs also overflows.
const FILE_COUNT = 500;
const TAB_COUNT = 24;

const fileName = (i: number) => `note-${String(i).padStart(3, "0")}.md`;

let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-uscroll-e2e-"));
  for (let i = 0; i < FILE_COUNT; i++) {
    writeFileSync(path.join(root, fileName(i)), `# ${fileName(i)}\n\nbody\n`);
  }
  // A deeply nested target for the reveal test.
  mkdirSync(path.join(root, "Deep", "Nested"), { recursive: true });
  writeFileSync(path.join(root, "Deep", "Nested", "target.md"), "# Target\n");
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));

async function open(page: Page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="Deep"]')).toBeVisible();
}

/** The single shared scroller. */
const scroller = (page: Page) => page.getByTestId("explorer-content-scroll");

test("Explorer has exactly one user-scrollable vertical container", async ({
  page,
}) => {
  await open(page);
  // Count elements inside the sidebar that are user-scrollable vertically:
  // overflow-y auto/scroll with overflowing content, excluding any element that
  // hides its scrollbar (the virtual tree stays scrollable for react-window /
  // keyboard nav but hides its scrollbar and forwards wheel gestures).
  const scrollableCount = await page
    .locator("aside")
    .evaluate((aside) => {
      const all = aside.querySelectorAll<HTMLElement>("*");
      let n = 0;
      for (const el of [aside as HTMLElement, ...Array.from(all)]) {
        const style = getComputedStyle(el);
        const overflowsY =
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 1;
        const scrollbarHidden =
          style.scrollbarWidth === "none" ||
          el.classList.contains("unified-tree-outer");
        if (overflowsY && !scrollbarHidden) n++;
      }
      return n;
    });
  expect(scrollableCount).toBe(1);
  await expect(scroller(page)).toBeVisible();
});

test("wheel over Files advances the shared scroller exactly like Open Tabs", async ({
  page,
}) => {
  await open(page);
  // Two tabs create a non-zero Files start offset while leaving the first tree
  // row visible, which reproduces the former Files-only jump.
  await page.locator(`[data-path="${fileName(0)}"]`).dblclick();
  await page.locator(`[data-path="${fileName(1)}"]`).dblclick();

  const el = scroller(page);
  const treeOuter = page.locator(".unified-tree-outer");
  await el.evaluate((node) => (node.scrollTop = 0));
  await expect.poll(() => treeOuter.evaluate((node) => node.scrollTop)).toBe(0);

  await page.getByText("Open Tabs", { exact: true }).hover();
  await page.mouse.wheel(0, 80);
  await expect.poll(() => el.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const tabsScrollTop = await el.evaluate((node) => node.scrollTop);

  await el.evaluate((node) => (node.scrollTop = 0));
  await expect.poll(() => treeOuter.evaluate((node) => node.scrollTop)).toBe(0);
  await page.locator(`[data-path="${fileName(0)}"]`).hover();
  await page.mouse.wheel(0, 80);
  await expect.poll(() => el.evaluate((node) => node.scrollTop)).toBe(tabsScrollTop);

  // The tree follows the shared position after the Files boundary; it must not
  // consume the same wheel gesture independently and push the shared scroller
  // to `filesTop + deltaY`.
  const positions = await page.evaluate(() => {
    const shared = document.querySelector<HTMLElement>(
      '[data-testid="explorer-content-scroll"]',
    )!;
    const tree = document.querySelector<HTMLElement>(".unified-tree-outer")!;
    return { shared: shared.scrollTop, tree: tree.scrollTop };
  });
  expect(positions.shared).toBe(tabsScrollTop);
  expect(positions.tree).toBeLessThan(positions.shared);
});

test("both section headers stay stacked and sticky: Files stays under Open Tabs", async ({
  page,
}) => {
  await open(page);
  // Open enough tabs that Open Tabs overflows on its own.
  for (let i = 0; i < TAB_COUNT; i++) {
    await page.locator(`[data-path="${fileName(i)}"]`).dblclick();
  }
  const openTabsHeader = page.getByText("Open Tabs", { exact: true });
  const filesHeader = page.getByText("Files", { exact: true });
  await expect(openTabsHeader).toBeVisible();
  await expect(filesHeader).toBeVisible();

  const el = scroller(page);
  const scrollerBox0 = await el.boundingBox();
  const openBox0 = await openTabsHeader.boundingBox();
  const filesBox0 = await filesHeader.boundingBox();
  // At the top both headers are stacked: Open Tabs first, Files directly below.
  expect(openBox0!.y).toBeGreaterThanOrEqual(scrollerBox0!.y - 2);
  expect(filesBox0!.y).toBeGreaterThan(openBox0!.y);
  expect(filesBox0!.y - openBox0!.y).toBeLessThan(60);

  // Scroll all the way down. BOTH headers must remain visible and pinned in the
  // same stacked order — Files never pushes Open Tabs out of view.
  await el.evaluate((n) => (n.scrollTop = n.scrollHeight));
  await expect.poll(() => el.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);

  await expect(openTabsHeader).toBeVisible();
  await expect(filesHeader).toBeVisible();
  const scrollerBox = await el.boundingBox();
  const openBox = await openTabsHeader.boundingBox();
  const filesBox = await filesHeader.boundingBox();
  // Open Tabs header text is still pinned within the top header band (its text
  // has top padding, so allow the header's 32px height as tolerance).
  expect(openBox!.y).toBeGreaterThanOrEqual(scrollerBox!.y - 2);
  expect(openBox!.y).toBeLessThan(scrollerBox!.y + 32);
  // Files header is still stacked directly beneath it.
  expect(filesBox!.y).toBeGreaterThan(openBox!.y);
  expect(filesBox!.y - openBox!.y).toBeLessThan(60);
});

test("the tree stays virtualized: far fewer than 60 rows are mounted", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(`[data-path="${fileName(0)}"]`)).toBeVisible();
  const mounted = await page.locator("[data-file-node]").count();
  // 500 files, ~28px rows in an ~800px viewport => well under 60 mounted.
  expect(mounted).toBeLessThan(60);
});

test("Show in file tree moves the shared scroller and centres a nested target", async ({
  page,
}) => {
  await open(page);
  // Open the target as a tab via quick search, then reveal it.
  await page.keyboard.press("ControlOrMeta+p");
  await page
    .getByRole("textbox", { name: "Search files", exact: true })
    .fill("target");
  await page.getByRole("option").filter({ hasText: "target" }).click();
  const row = page.locator('[data-tab-id="Deep/Nested/target.md"]');
  const target = page.locator('[data-path="Deep/Nested/target.md"]');
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Show in file tree", exact: true })
    .click();
  await expect(target).toBeInViewport();
  await expect(
    target.locator("xpath=ancestor::*[@role='treeitem']"),
  ).toHaveAttribute("aria-selected", "true");
});

test("Page Down while the tree is focused advances the shared scroll position", async ({
  page,
}) => {
  await open(page);
  const first = page.locator(`[data-path="${fileName(0)}"]`);
  await first.click();
  // Focus the tree so keyboard nav is handled by react-arborist.
  await page.locator('[role="tree"]').focus();
  const el = scroller(page);
  const before = await el.evaluate((n) => n.scrollTop);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => el.evaluate((n) => n.scrollTop))
    .toBeGreaterThan(before);
});

test("a full page reload starts at scrollTop = 0", async ({ page }) => {
  await open(page);
  const el = scroller(page);
  await el.evaluate((n) => (n.scrollTop = 500));
  await expect.poll(() => el.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('[data-path="Deep"]')).toBeVisible();
  await expect
    .poll(() => scroller(page).evaluate((n) => n.scrollTop))
    .toBe(0);
});

test("closing and reopening the sidebar restores the runtime scroll position", async ({
  page,
}) => {
  await open(page);
  const el = scroller(page);
  await el.evaluate((n) => (n.scrollTop = 420));
  await expect.poll(() => el.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  const saved = await el.evaluate((n) => n.scrollTop);

  // Collapse the sidebar, then expand it again.
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await expect(page.getByTestId("explorer-content-scroll")).toHaveCount(0);
  await page.getByRole("button", { name: "Open sidebar" }).click();

  await expect(page.getByTestId("explorer-content-scroll")).toBeVisible();
  await expect
    .poll(() => scroller(page).evaluate((n) => n.scrollTop))
    .toBeGreaterThan(saved - 40);
});
