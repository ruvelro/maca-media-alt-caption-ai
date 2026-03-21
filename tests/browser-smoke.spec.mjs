import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

const fixtureHtml = fs.readFileSync(path.resolve("tests", "fixtures", "wp-admin-upload.html"), "utf8");
const sharedScripts = [
  "src/shared/wp_dom_shared.js",
  "src/shared/wp_selectors_shared.js",
  "src/shared/wp_media_shared.js"
].map((file) => fs.readFileSync(path.resolve(file), "utf8"));

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

test.beforeEach(async ({ page }) => {
  await page.goto(`${baseUrl}/wp-admin/upload.php`);
  for (const content of sharedScripts) {
    await page.addScriptTag({ content });
  }
});

test("shared WordPress media helpers detect selected attachments in a real browser", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__MACA_WP_MEDIA;
    const els = api.getWpSelectedAttachmentEls(document);
    return els.map((el) => ({ id: el.getAttribute("data-id"), title: el.getAttribute("data-title") }));
  });
  expect(Array.isArray(result)).toBeTruthy();
  expect(result.length).toBe(2);
  expect(result[0].id).toBe("101");
  expect(result[1].id).toBe("102");
});

test("shared WordPress DOM helpers apply alt, title and caption in a real browser", async ({ page }) => {
  const result = await page.evaluate(() => {
    const dom = window.__MACA_WP_DOM;
    const selectors = window.__MACA_WP_SELECTORS;
    const roots = [document.querySelector(".attachment-details"), document].filter(Boolean);
    const alt = dom.pickFieldFromSelectors(roots, selectors.getAttachmentFieldSelectors("101", "alt"));
    const title = dom.pickFieldFromSelectors(roots, selectors.getAttachmentFieldSelectors("101", "title"));
    const caption = dom.pickFieldFromSelectors(roots, selectors.getAttachmentFieldSelectors("101", "caption"));
    return {
      alt: dom.setWpFormValue(alt, "Alt de prueba"),
      title: dom.setWpFormValue(title, "Titulo prueba"),
      leyenda: dom.setWpFormValue(caption, "Leyenda prueba")
    };
  });
  expect(result.alt).toBeTruthy();
  expect(result.title).toBeTruthy();
  expect(result.leyenda).toBeTruthy();
  await expect(page.locator("#attachment_alt")).toHaveValue("Alt de prueba");
  await expect(page.locator("#attachment_title")).toHaveValue("Titulo prueba");
  await expect(page.locator("#attachment_caption_editable")).toHaveText("Leyenda prueba");
});
