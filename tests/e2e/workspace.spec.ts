import { test, expect, type Page } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
let root: string;
test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "maek-v1-e2e-"));
  mkdirSync(path.join(root, "Folder"));
  writeFileSync(
    path.join(root, "Folder", "기존 노트.md"),
    "---\ncustom: keep-me\n---\n\n# Original\n\nExisting paragraph.\n",
  );
  writeFileSync(path.join(root, "readme.txt"), "Plain text preview");
  writeFileSync(path.join(root, "index.html"), "<h1>Rendered HTML</h1>");
  writeFileSync(path.join(root, "data.db"), "\0binary");
});
test.afterEach(() => rmSync(root, { recursive: true, force: true }));
async function open(page: Page) {
  await page.goto("/");
  await page.getByText("Enter folder path", { exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace path" }).fill(root);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-path="Folder"]')).toBeVisible();
}
function webSessionFile(name: string) {
  const sessionsRoot = path.join(root, ".maek/sessions/web");
  if (!existsSync(sessionsRoot)) return null;
  const sessionId = readdirSync(sessionsRoot)[0];
  if (!sessionId) return null;
  const file = path.join(sessionsRoot, sessionId, name);
  return existsSync(file) ? file : null;
}
async function editNote(page: Page) {
  await page.locator('[data-path="Folder"]').click();
  await page.locator('[data-path="Folder/기존 노트.md"]').click();
  await expect(page.locator(".tiptap")).toBeVisible();
}
test("opens existing nested notes, edits with Tiptap, restores session and theme", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await editNote(page);
  expect(
    readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"),
  ).toContain("custom: keep-me");
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.type(" 한국어 편집");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("한국어 편집");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(
      () => {
        const tabs = webSessionFile("tabs.json");
        if (!tabs) return undefined;
        return JSON.parse(readFileSync(tabs, "utf8")).theme;
      },
    )
    .toBe("dark");
  await page.screenshot({ path: "test-results/v1-editor-dark.png" });
  await page.reload();
  await expect(page.locator(".tiptap")).toContainText("한국어 편집");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(readdirSync(root).sort()).toEqual(
    [".maek", "Folder", "data.db", "index.html", "readme.txt"].sort(),
  );
  expect(errors).toEqual([]);
});
test("external watcher updates files and protects dirty edits", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# External\n\nFresh content",
  );
  await expect(page.locator(".tiptap")).toContainText("Fresh content");
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Unsaved local");
  writeFileSync(
    path.join(root, "Folder/기존 노트.md"),
    "# Other editor\n\nDisk version",
  );
  await expect(page.getByRole("alert")).toContainText(
    /externally|changed|바뀌/,
  );
  await page.waitForTimeout(1700);
  expect(
    readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"),
  ).toContain("Disk version");
  await expect(page.locator(".tiptap")).toContainText("Unsaved local");
  writeFileSync(path.join(root, "outside.md"), "# Added");
  await expect(page.locator('[data-path="outside.md"]')).toBeVisible();
});
test("search, read-only preview, unsupported file and native picker cancel", async ({
  page,
}) => {
  await page.goto("/");
  await page.route("**/api/workspaces/pick", (route) => {
    expect(route.request().headers()["content-type"]).toBeUndefined();
    return route.fulfill({ json: { status: "canceled" } });
  });
  await page.getByRole("button", { name: "Open Folder", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Open your workspace" }),
  ).toBeVisible();
  await open(page);
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("textbox", { name: "Search files" }).fill("readme");
  await page.getByRole("option").first().click();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  await page.locator('[data-path="index.html"]').click();
  await expect(page.locator('iframe[title="index.html"]')).toBeVisible();
  await page.locator('[data-path="data.db"]').click();
  await expect(
    page.getByText("Unsupported file format", { exact: true }),
  ).toBeVisible();
});

test("rename, duplicate, move and delete use the tree and real paths", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page
    .locator('[data-path="Folder/기존 노트.md"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", { name: "File name" });
  await input.fill("Renamed.md");
  await input.press("Enter");
  await expect(page.locator('[data-path="Folder/Renamed.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="Folder/Renamed.md"]')).toBeVisible();
  await page
    .locator('[data-path="Folder/Renamed.md"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.locator('[data-path="Folder/Renamed 2.md"]')).toBeVisible();
  await page
    .locator('[data-path="Folder/Renamed 2.md"]')
    .dragTo(page.locator('[data-path="Folder"]'), {
      targetPosition: { x: 5, y: 14 },
    });
  // External move uses inode pairing, including an open tab.
  renameSync(path.join(root, "Folder/Renamed.md"), path.join(root, "Moved.md"));
  await expect(page.locator('[data-path="Moved.md"]')).toBeVisible();
  await expect(page.locator('[data-tab-id="Moved.md"]')).toBeVisible();
  await expect(page.locator(".tiptap")).toContainText("Original");
  // Mock the destructive OS boundary but exercise the actual UI request.
  let deleted: string[] = [];
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleted = route.request().postDataJSON().paths;
    for (const p of deleted) rmSync(path.join(root, p));
    return route.fulfill({ json: { ok: true } });
  });
  page.on("dialog", (d) => void d.accept());
  await page.locator('[data-path="Moved.md"]').click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move to Trash", exact: true })
    .click();
  await expect.poll(() => deleted).toEqual(["Moved.md"]);
  await expect(page.locator('[data-path="Moved.md"]')).toHaveCount(0);
});

test("original slash menu, table, math, image and frontmatter work in Tiptap", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(page.locator(".maek-slash-menu")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tiptap table")).toHaveCount(1);
  await page.getByRole("button", { name: "1 properties" }).click();
  await expect(
    page.getByRole("textbox", { name: "key", exact: true }),
  ).toHaveValue("custom");
  const file = path.join(root, "rich.md");
  writeFileSync(
    file,
    "# Rich\n\n## Editor features\n\n### Details\n\n- [ ] Task\n\n$$\nx^2\n$$\n\n```js\nconst x = 1\n```\n",
  );
  await expect(page.locator('[data-path="rich.md"]')).toBeVisible();
  await page.locator('[data-path="rich.md"]').click();
  await expect(page.locator('.tiptap input[type="checkbox"]')).toHaveCount(1);
  await expect(page.locator(".tiptap .katex")).toBeVisible();
  await expect(page.locator(".tiptap-code-block")).toBeVisible();
  const headingRail = page.getByRole("navigation", {
    name: "Document headings",
  });
  await expect(headingRail).toBeVisible();
  await headingRail.hover();
  await expect(
    headingRail.getByText("Editor features", { exact: true }),
  ).toBeVisible();
  await expect(headingRail.getByText("Details", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      headingRail.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(180);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".tiptap img")).toBeVisible();
  await expect
    .poll(() => readFileSync(file, "utf8"))
    .toContain(".maek/assets/pixel.png");
  await page.screenshot({ path: "test-results/v1-editor-light.png" });
});

test("switching tabs during a delayed save preserves the latest edit", async ({
  page,
}) => {
  await open(page);
  await editNote(page);
  await page.route("**/api/files/content", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  const area = page.locator(".tiptap");
  await area.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" First edit");
  await page.keyboard.press("ControlOrMeta+s");
  await page.keyboard.type(" Latest edit");
  await page.locator('[data-path="readme.txt"]').click();
  await page.locator('[data-tab-id="Folder/기존 노트.md"]').click();
  await expect(area).toContainText("Latest edit");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("Latest edit");
});

test("opening and switching an untouched note never rewrites its Markdown", async ({
  page,
}) => {
  const file = path.join(root, "Folder/기존 노트.md");
  const original = readFileSync(file, "utf8");
  const mtime = statSync(file).mtimeMs;
  await open(page);
  await editNote(page);
  await page.waitForTimeout(1800); // Cross the autosave debounce without editing.
  await page.locator('[data-path="readme.txt"]').click();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  await expect
    .poll(
      () => {
        const tabs = webSessionFile("tabs.json");
        return tabs ? JSON.parse(readFileSync(tabs, "utf8")).activeTabId : null;
      },
    )
    .toMatch(/\/readme\.txt$/);
  await page.reload();
  await expect(page.locator("pre")).toHaveText("Plain text preview");
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(statSync(file).mtimeMs).toBe(mtime);
});

test("original note picker inserts encoded links and opens literal-percent filenames", async ({
  page,
}) => {
  writeFileSync(path.join(root, "Target %20 노트.md"), "# Linked target\n");
  await open(page);
  await editNote(page);
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[[");
  await page.getByPlaceholder("Search notes...").fill("Target");
  await page.getByPlaceholder("Search notes...").press("Enter");
  const link = page.locator(".tiptap a.maek-note-link");
  await expect(link).toHaveAttribute(
    "href",
    "../Target%20%2520%20%EB%85%B8%ED%8A%B8.md",
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => readFileSync(path.join(root, "Folder/기존 노트.md"), "utf8"))
    .toContain("%2520");
  await link.click();
  await expect(page.locator(".tiptap")).toContainText("Linked target");
  await expect(
    page.locator('[data-tab-id="Target %20 노트.md"]'),
  ).toBeVisible();
});

test("opens a new tree note while tabs restored from .maek remain open", async ({
  page,
}) => {
  writeFileSync(path.join(root, "second.md"), "# Second note\n");
  await open(page);
  await editNote(page);
  await expect
    .poll(() => {
      const tabs = webSessionFile("tabs.json");
      return tabs ? JSON.parse(readFileSync(tabs, "utf8")).tabs.length : 0;
    })
    .toBe(1);
  await page.reload();
  await expect(
    page.locator('[data-tab-id="Folder/기존 노트.md"]'),
  ).toBeVisible();
  await page.locator('[data-path="second.md"]').click();
  await expect(page.locator('[data-tab-id="second.md"]')).toBeVisible();
  await expect(page.locator(".tiptap")).toContainText("Second note");
  await expect(page.locator('[role="tab"]')).toHaveCount(2);
});
