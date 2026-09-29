import { readFile, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const results = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const scope of ["all", "selection"]) {
    const pdf = await getDocument({
      data: new Uint8Array(await readFile(`artifacts/export-${scope}.pdf`)),
    }).promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const target = pdf.canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: target.context, viewport }).promise;
    await writeFile(
      `artifacts/pdf-${scope}-external.png`,
      target.canvas.toBuffer("image/png"),
    );
    const source = await readFile(`artifacts/export-${scope}.svg`, "utf8");
    const viewBox = source
      .match(/viewBox="([^"]+)"/)[1]
      .split(" ")
      .map(Number);
    const svg = { width: viewBox[2], height: viewBox[3] };
    const external = await browser.newPage({
      viewport: { width: svg.width, height: svg.height },
      deviceScaleFactor: 1,
    });
    await external.goto(
      pathToFileURL(path.resolve(`artifacts/export-${scope}.svg`)).href,
    );
    await external.evaluate(async () => {
      for (const element of document.querySelectorAll("image")) {
        const image = new Image();
        image.src = element.href.baseVal;
        await image.decode();
      }
    });
    await external.screenshot({ path: `artifacts/svg-${scope}-external.png` });
    if (scope === "all") {
      const embedded = source.match(
        /<image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" xlink:href="([^"]+)"/,
      );
      assert.ok(embedded, "fixture must contain an embedded screenshot");
      const rendered = await loadImage(
        await readFile("artifacts/svg-all-external.png"),
      );
      const canvas = createCanvas(rendered.width, rendered.height);
      const context = canvas.getContext("2d");
      context.drawImage(rendered, 0, 0);
      const region = context.getImageData(
        Math.round(+embedded[1] - viewBox[0]),
        Math.round(+embedded[2] - viewBox[1]),
        Math.floor(+embedded[3]),
        Math.floor(+embedded[4]),
      ).data;
      const colors = new Set();
      for (let i = 0; i < region.length; i += 80)
        colors.add(`${region[i]},${region[i + 1]},${region[i + 2]}`);
      assert.ok(
        colors.size > 30,
        "embedded screenshot must be visible outside Axon",
      );
    }
    await external.close();
    const png = await loadImage(
      await readFile(`artifacts/export-${scope}.png`),
    );
    assert.equal(png.width, svg.width * 2);
    assert.equal(png.height, svg.height * 2);
    assert.equal(Math.round(viewport.width), svg.width);
    assert.equal(Math.round(viewport.height), svg.height);
    results.push({
      scope,
      width: svg.width,
      height: svg.height,
      pngScale: 2,
      pdfPages: pdf.numPages,
    });
    await pdf.cleanup();
  }
} finally {
  await browser.close();
}
const transparent = await loadImage(
  await readFile("artifacts/export-transparent-1x.png"),
);
const alphaCanvas = createCanvas(transparent.width, transparent.height);
const alphaContext = alphaCanvas.getContext("2d");
alphaContext.drawImage(transparent, 0, 0);
assert.equal(alphaContext.getImageData(0, 0, 1, 1).data[3], 0);
assert.equal(transparent.width, 294);
assert.equal(transparent.height, 254);
await writeFile(
  "artifacts/export-results.json",
  JSON.stringify(results, null, 2),
);
console.log(
  "PASS independent PDF.js / Microsoft Edge export rendering",
  results,
);
