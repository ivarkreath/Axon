import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve("artifacts/controls");
const svg = await readFile(path.join(out, "endings.svg"), "utf8");
const box = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
const png = await loadImage(await readFile(path.join(out, "endings.png")));
assert.equal(png.width, box[2] * 2);
assert.equal(png.height, box[3] * 2);
assert.ok(!svg.includes("data-end") && !svg.includes("selection"));
const pdf = await getDocument({ data: new Uint8Array(await readFile(path.join(out, "endings.pdf"))) }).promise;
assert.equal(pdf.numPages, 1);
const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 2 });
assert.equal(viewport.width, png.width); assert.equal(viewport.height, png.height);
const target = pdf.canvasFactory.create(viewport.width, viewport.height);
await page.render({ canvasContext: target.context, viewport }).promise;
await writeFile(path.join(out, "endings-pdf.png"), target.canvas.toBuffer("image/png"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const external = await browser.newPage({ viewport: { width: box[2], height: box[3] }, deviceScaleFactor: 2 });
  await external.goto(pathToFileURL(path.join(out, "endings.svg")).href);
  assert.ok(await external.locator("svg path").count() > 10);
  await external.screenshot({ path: path.join(out, "endings-svg.png") });
} finally { await browser.close(); }
console.log("PASS independent SVG (Edge), PDF (PDF.js) and PNG dimensions/rendering for new endings");
