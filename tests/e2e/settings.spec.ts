import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

let root: string;
let otherRoot: string;

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "maek-settings-e2e-")));
  mkdirSync(path.join(root, "Folder"));
  writeFileSync(path.join(root, "Folder", "Note.md"), "# Note\n\nBody.\n");

  otherRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "maek-settings-e2e-other-")),
  );
  mkdirSync(path.join(otherRoot, "Other"));
  writeFileSync(path.join(otherRoot, "Other", "Other.md"), "# Other\n");
});

test.afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
});

async function openWorkspace(page: Page, folder: string) {
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(folder);
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

async function open(page: Page) {
  await page.goto("/");
  await openWorkspace(page, root);
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

function cssVar(page: Page, name: string) {
  return page.evaluate(
    (varName) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim(),
    name,
  );
}

test("accent color, font size and line height apply immediately via CSS variables", async ({
  page,
}) => {
  await open(page);
  await openSettings(page);

  // Accent color: pick "Blue" and confirm the shared accent variable updates.
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await expect
    .poll(() => cssVar(page, "--color-maek-red"))
    .toBe("#2563eb");
  await expect
    .poll(() => cssVar(page, "--color-maek-red-hover"))
    .toBe("#1d4ed8");

  // Font size: move the range to its maximum and confirm the editor var.
  const fontSize = page.getByRole("slider", { name: "Font size" });
  await fontSize.focus();
  await fontSize.press("End");
  await expect.poll(() => cssVar(page, "--font-editor-size")).toBe("20px");

  // Line height: move to minimum.
  const lineHeight = page.getByRole("slider", { name: "Line height" });
  await lineHeight.focus();
  await lineHeight.press("Home");
  await expect.poll(() => cssVar(page, "--line-spacing-editor")).toBe("1");
});

test("preferences restore after reload from localStorage", async ({ page }) => {
  await open(page);
  await openSettings(page);

  await page.getByRole("button", { name: "Purple", exact: true }).click();
  await expect.poll(() => cssVar(page, "--color-maek-red")).toBe("#7c3aed");

  // The persisted payload lives under the documented key.
  const stored = await page.evaluate(() =>
    localStorage.getItem("maek:preferences"),
  );
  expect(stored && JSON.parse(stored).accent).toBe("purple");

  await page.reload();
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
  // Restored on boot before any interaction.
  await expect.poll(() => cssVar(page, "--color-maek-red")).toBe("#7c3aed");
});

test("theme choice persists across a workspace switch", async ({ page }) => {
  const rootName = path.basename(root);
  const otherName = path.basename(otherRoot);

  // Seed both folders into this browser's recent list so each can be opened
  // through a real `/api/workspaces/open` call (what the recent buttons do).
  await page.goto("/");
  await page.evaluate(
    (folders) => {
      localStorage.setItem(
        "maek:workspaces",
        JSON.stringify(
          folders.map((p) => ({ id: p, name: p.split("/").pop(), path: p })),
        ),
      );
    },
    [root, otherRoot],
  );
  await open(page); // opens root via path entry

  // Set dark theme on the root workspace.
  await openSettings(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");

  // Switch to the other workspace via the recent list.
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: `Open ${otherName}`, exact: true }).click();
  await expect(page.locator('[data-path="Other"]')).toBeVisible();

  // Switch back to root; its stored (app-shared) theme must still be dark.
  await openSettings(page);
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: `Open ${rootName}`, exact: true }).click();
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
});

test("About page renders version and links", async ({ page }) => {
  await open(page);
  await openSettings(page);
  await page.getByRole("button", { name: "About" }).click();

  await expect(page.getByText(/Web version/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official website" }),
  ).toHaveAttribute("href", "https://maeknote.com");
  await expect(
    page.getByRole("link", { name: "Discord community" }),
  ).toHaveAttribute("href", "https://discord.com/invite/Ep5mv4fTxA");
  await expect(
    page.getByRole("link", { name: "GitHub repository" }),
  ).toHaveAttribute("href", "https://github.com/maeknote/maek");
  await expect(
    page.getByRole("link", { name: "Contact & feedback" }),
  ).toHaveAttribute("href", "mailto:maeknote@gmail.com");
});

test("removing a recent workspace does not delete its files", async ({
  page,
}) => {
  const otherName = path.basename(otherRoot);

  // Seed the recent list with both folders on this origin, then open root.
  await page.goto("/");
  await page.evaluate(
    (folders) => {
      localStorage.setItem(
        "maek:workspaces",
        JSON.stringify(
          folders.map((p) => ({ id: p, name: p.split("/").pop(), path: p })),
        ),
      );
    },
    [root, otherRoot],
  );
  await open(page);

  await openSettings(page);
  await page.getByRole("button", { name: "Workspace" }).click();

  await page
    .getByRole("button", { name: `Remove ${otherName} from list`, exact: true })
    .click();

  // It disappears from the browser list…
  await expect(
    page.getByRole("button", { name: `Remove ${otherName} from list`, exact: true }),
  ).toHaveCount(0);
  // …but the folder and its files remain on disk (non-destructive).
  expect(existsSync(path.join(otherRoot, "Other", "Other.md"))).toBe(true);
});
