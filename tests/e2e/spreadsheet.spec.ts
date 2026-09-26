import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * CSV spreadsheet scenarios. These open a real CSV fixture from the tree (the
 * "New CSV" tree-menu entry does not exist in this build) and assert on actual
 * saved file content and stable selectors (role=grid, data-sheet-cell,
 * .csv-cell-editor) rather than library-internal CSS classes.
 */

let root: string;

test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-sheet-e2e-"));
  mkdirSync(path.join(root, "Folder"));
  writeFileSync(path.join(root, "data.csv"), "name,score\nalice,10\nbob,20\n");
});

async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="data.csv"]')).toBeVisible();
}

test("edits a CSV cell, saves, and preserves the file content", async ({ page }) => {
  await open(page);
  await page.locator('[data-path="data.csv"]').click();
  await expect(page.getByRole("grid", { name: "data.csv" })).toBeVisible();

  // Edit A1 (document cell 0:0) via the shared cell editor.
  const a1 = page.locator('[data-sheet-cell="0:0"]');
  await a1.dblclick();
  const editor = page.locator(".csv-cell-editor");
  await editor.fill("이름");
  await editor.press("Enter");
  await expect(a1).toContainText("이름");

  // Undo reverts, redo restores.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(a1).toContainText("name");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(a1).toContainText("이름");

  // Save and verify the file content on disk (no fixed sleeps).
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => readFileSync(path.join(root, "data.csv"), "utf8"))
    .toBe("이름,score\nalice,10\nbob,20\n");
});

test("computes a formula result while preserving the formula source", async ({ page }) => {
  writeFileSync(path.join(root, "calc.csv"), "2,3,=A1+B1\n");
  await open(page);
  await page.locator('[data-path="calc.csv"]').click();
  await expect(page.getByRole("grid", { name: "calc.csv" })).toBeVisible();

  // The formula cell (0:2) shows the calculated result, not the source.
  await expect(page.locator('[data-sheet-cell="0:2"]')).toContainText("5");

  // The formula bar shows the raw formula when the cell is active.
  await page.locator('[data-sheet-cell="0:2"]').click();
  await expect(page.getByRole("textbox", { name: "Cell value or formula" })).toHaveValue("=A1+B1");
});

test("preserves leading-zero strings verbatim", async ({ page }) => {
  writeFileSync(path.join(root, "zeros.csv"), "00123,hello\n");
  await open(page);
  await page.locator('[data-path="zeros.csv"]').click();
  await expect(page.getByRole("grid", { name: "zeros.csv" })).toBeVisible();
  await expect(page.locator('[data-sheet-cell="0:0"]')).toContainText("00123");
});
