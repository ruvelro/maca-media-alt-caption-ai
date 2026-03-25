import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { test, expect, chromium } from "@playwright/test";

const fixtureHtml = fs.readFileSync(path.resolve("tests", "fixtures", "wp-admin-upload.html"), "utf8");

let server;
let baseUrl;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/wp-admin/upload.php")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function withExtension(run) {
  const extensionPath = path.resolve("maca por chrome");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maca-ext-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.PLAYWRIGHT_EXTENSION_CHANNEL || "msedge",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    await run({ context, worker });
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test("chrome extension service worker loads and options page opens", async () => {
  await withExtension(async ({ context, worker }) => {
    expect(worker.url()).toContain("chrome-extension://");

    const details = await worker.evaluate(() => ({
      manifest: chrome.runtime.getManifest(),
      optionsUrl: chrome.runtime.getURL("options.html")
    }));

    expect(details.manifest.version).toBe("1.0.11");
    const page = await context.newPage();
    await page.goto(details.optionsUrl);
    await expect(page.locator("body")).toContainText("maca");
  });
});

test("selected candidate prefers current gallery image and includes filename context", async () => {
  await withExtension(async ({ context, worker }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/wp-admin/upload.php`);
    await page.waitForTimeout(500);

    await page.locator('li.attachment[data-id="102"]').click();

    const result = await worker.evaluate(async ({ baseUrl }) => {
      const [tab] = await chrome.tabs.query({ url: `${baseUrl}/*wp-admin/*` });
      return chrome.tabs.sendMessage(tab.id, { type: "MACA_GET_SELECTED_CANDIDATE" });
    }, { baseUrl });

    expect(result?.ok).toBeTruthy();
    expect(String(result?.filenameContext || "")).toContain("foto-b.jpg");
  });
});
