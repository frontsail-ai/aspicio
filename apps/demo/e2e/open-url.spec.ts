import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const REMOTE = "https://remote.test/box.dxf";

/** Serve the box fixture at REMOTE with proper CORS + Content-Length headers. */
async function serveFixture(page: Page, url = REMOTE, file = "box.dxf"): Promise<void> {
  const bytes = await readFile(fixture(file));
  await page.route(url, (route: Route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/dxf",
        "content-length": String(bytes.length),
        "access-control-allow-origin": "*",
      },
      body: bytes,
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Open-DXF dialog gates the URL submit on a valid http(s) URL", async ({ page }) => {
  await page.locator("#open").click();
  await expect(page.locator("#open-dialog")).toBeVisible();

  // Defaults to the file tab with the dropzone.
  await expect(page.locator("#od-dropzone")).toBeVisible();

  await page.locator("#od-tab-url").click();
  const open = page.locator("#od-open");
  await expect(open).toBeDisabled();

  await page.locator("#od-input").fill("not-a-url");
  await expect(open).toBeDisabled();

  // Enter on an unfixable value surfaces the hint (the only feedback path,
  // since the Open button is disabled and can't be clicked).
  await page.locator("#od-input").press("Enter");
  await expect(page.locator("#od-invalid")).toBeVisible();
  await expect(page.locator("#od-input")).toHaveClass(/invalid/);

  await page.locator("#od-input").fill("https://remote.test/box.dxf");
  await expect(open).toBeEnabled();
  await expect(page.locator("#od-invalid")).toBeHidden(); // typing clears the hint

  // A scheme-less but domain-shaped value is accepted (assumed https://).
  await page.locator("#od-input").fill("example.com/drawing.dxf");
  await expect(open).toBeEnabled();
  // A non-http scheme stays rejected.
  await page.locator("#od-input").fill("ftp://x/y.dxf");
  await expect(open).toBeDisabled();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#open-dialog")).toBeHidden();
});

test("a scheme-less URL is fetched as https://", async ({ page }) => {
  const bytes = await readFile(fixture("box.dxf"));
  await page.route("https://cdn.example.test/box.dxf", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-length": String(bytes.length),
        "access-control-allow-origin": "*",
      },
      body: bytes,
    }),
  );
  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill("cdn.example.test/box.dxf"); // no scheme
  await page.locator("#od-open").click();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toContain(encodeURIComponent("https://cdn.example.test/box.dxf"));
});

test("loads a DXF from a remote URL and makes it a shareable link", async ({ page }) => {
  await serveFixture(page);

  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(REMOTE);
  await page.locator("#od-open").click();

  // Dialog closes, drawing shows, name comes from the URL.
  await expect(page.locator("#open-dialog")).toBeHidden();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect(page.locator("#controls")).toBeVisible();

  // The source is written into the share hash (debounced) so the link restores it.
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toContain(`src=${encodeURIComponent(REMOTE)}`);
});

test("a fetch failure shows the CORS guidance card, not a broken load", async ({ page }) => {
  // No ACAO header + abort → the browser reports an opaque network failure.
  await page.route(REMOTE, (route) => route.abort());

  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(REMOTE);
  await page.locator("#od-open").click();

  await expect(page.locator("#od-cors")).toBeVisible();
  await expect(page.locator("#od-cors-title, .od-cors-title")).toContainText("Couldn't fetch");
  await expect(page.locator("#od-cors-url")).toHaveText(REMOTE);
  await expect(page.locator("#od-retry")).toBeVisible();

  // Editing goes back to the URL form with the value intact.
  await page.locator("#od-edit").click();
  await expect(page.locator("#od-input")).toHaveValue(REMOTE);
});

test("an HTTP error tailors the guidance to the status", async ({ page }) => {
  await page.route(REMOTE, (route) =>
    route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "nope" }),
  );
  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(REMOTE);
  await page.locator("#od-open").click();

  await expect(page.locator("#od-cors")).toBeVisible();
  await expect(page.locator("#od-cors-title")).toContainText("404");
  await expect(page.locator("#od-tip-status")).toBeVisible();
  await expect(page.locator("#od-tip-status")).toContainText("moved or been removed");
  // CORS-hosting advice doesn't fit a 404 — it's suppressed.
  await expect(page.locator("#od-tip-cors")).toBeHidden();
});

test("a URL that returns non-DXF bytes stays in the URL flow", async ({ page }) => {
  const BAD = "https://remote.test/bad.dxf";
  const badBytes = await readFile(fixture("invalid.dxf"));
  await serveFixture(page); // REMOTE → valid box.dxf
  await page.route(BAD, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-length": String(badBytes.length),
        "access-control-allow-origin": "*",
      },
      body: badBytes,
    }),
  );

  // Load a valid drawing first, establishing its share hash.
  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(REMOTE);
  await page.locator("#od-open").click();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(encodeURIComponent(REMOTE));

  // Now open a URL that downloads fine but isn't a DXF.
  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(BAD);
  await page.locator("#od-open").click();

  // Parse error is shown in the dialog (not the file toast), keeping URL context.
  await expect(page.locator("#od-cors")).toBeVisible();
  await expect(page.locator("#od-cors-title")).toContainText("isn't a valid DXF");
  await expect(page.locator("#error-toast")).toBeHidden();

  // The previous drawing and its share hash are untouched by the failed swap.
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  const hash = await page.evaluate(() => location.hash);
  expect(hash).toContain(encodeURIComponent(REMOTE));
  expect(hash).not.toContain(encodeURIComponent(BAD));

  // Edit URL returns to the form with the bad value, ready to fix.
  await page.locator("#od-edit").click();
  await expect(page.locator("#od-input")).toHaveValue(BAD);
});

test("a #src= deep link auto-loads the drawing on cold start", async ({ page }) => {
  await serveFixture(page);
  // A fragment-only goto from "/" wouldn't reload; reload re-runs cold start.
  await page.goto(`/#src=${encodeURIComponent(REMOTE)}`);
  await page.reload();

  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect(page.locator("#controls")).toBeVisible();
});

test("pasting a #src= link into the address bar (hashchange) loads it live", async ({ page }) => {
  const OTHER = "https://remote.test/layout.dxf";
  await serveFixture(page); // REMOTE → box.dxf
  await serveFixture(page, OTHER, "layout.dxf");

  // Start on the sample, then change only the fragment (as an address-bar paste).
  await page.locator("#empty-sample").click();
  await expect(page.locator("#file-chip")).toHaveText("sample.dxf");

  await page.evaluate((u) => {
    location.hash = "src=" + encodeURIComponent(u);
  }, REMOTE);
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");

  // A second live hashchange swaps to a different drawing.
  await page.evaluate((u) => {
    location.hash = "src=" + encodeURIComponent(u);
  }, OTHER);
  await expect(page.locator("#file-chip")).toHaveText("layout.dxf");

  // Back navigation restores the previous shared link.
  await page.goBack();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
});

test("a hashchange that loads a drawing closes an open dialog", async ({ page }) => {
  await serveFixture(page);
  // Open the dialog, then let a navigation load a drawing underneath.
  await page.locator("#open").click();
  await expect(page.locator("#open-dialog")).toBeVisible();
  await page.evaluate((u) => {
    location.hash = "src=" + encodeURIComponent(u);
  }, REMOTE);
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect(page.locator("#open-dialog")).toBeHidden(); // superseded, like a drop

  // But a garbage hash must NOT close the dialog.
  await page.locator("#open").click();
  await expect(page.locator("#open-dialog")).toBeVisible();
  await page.evaluate(() => {
    location.hash = "junk=1";
  });
  await expect(page.locator("#open-dialog")).toBeVisible();
});

test("the dialog reopens on the tab last used", async ({ page }) => {
  await page.locator("#open").click();
  await expect(page.locator("#od-dropzone")).toBeVisible(); // defaults to file first time
  await page.locator("#od-tab-url").click();
  await page.keyboard.press("Escape");

  // Reopening lands on From URL, not back on From file.
  await page.locator("#open").click();
  await expect(page.locator("#od-url")).toBeVisible();
  await expect(page.locator("#od-tab-url")).toHaveClass(/active/);
});

test("remembers recent URLs and can clear them", async ({ page }) => {
  await serveFixture(page);

  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await page.locator("#od-input").fill(REMOTE);
  await page.locator("#od-open").click();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");

  // Reopen — the load shows up under RECENT, with its origin host so same-named
  // files from different hosts stay distinguishable (#6).
  await page.locator("#open").click();
  await page.locator("#od-tab-url").click();
  await expect(page.locator("#od-recents")).toBeVisible();
  await expect(page.locator(".od-recent-name")).toHaveText("box.dxf");
  await expect(page.locator(".od-recent-host")).toHaveText("remote.test");

  // Clicking a recent refills the field without loading.
  await page.locator("#od-input").fill("");
  await page.locator(".od-recent").first().click();
  await expect(page.locator("#od-input")).toHaveValue(REMOTE);

  await page.locator("#od-clear").click();
  await expect(page.locator("#od-recents")).toBeHidden();
});

test("pasting a .dxf link raises a confirm toast that loads it", async ({ page }) => {
  await serveFixture(page);

  await page.evaluate((url) => window.__demo?.simulatePaste(url), REMOTE);
  await expect(page.locator("#paste-toast")).toBeVisible();
  await expect(page.locator("#paste-url")).toHaveText(REMOTE);

  await page.locator("#paste-open").click();
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
});

test("opening a local file clears a stale remote share hash", async ({ page }) => {
  await serveFixture(page);
  await page.goto(`/#src=${encodeURIComponent(REMOTE)}`);
  await page.reload(); // fragment-only goto from "/" wouldn't reload
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect.poll(() => page.evaluate(() => location.hash)).toContain("src=");

  // A local file isn't URL-addressable → the hash is dropped (DEMO-7).
  await page.locator("#file").setInputFiles(fixture("layout.dxf"));
  await expect(page.locator("#file-chip")).toHaveText("layout.dxf");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
});
