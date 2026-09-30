import { _electron as electron } from "playwright";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const out = path.resolve("artifacts/quick-color");
const profile = path.join(out, "profile-" + Date.now());
await mkdir(profile, { recursive: true });
await build({ entryPoints: ["src/model/document.ts", "src/shared/contracts.ts"], bundle: true, platform: "node", format: "esm", outdir: path.join(out, "fixture") });
const { emptyDocument, createObject } = await import(pathToFileURL(path.join(out, "fixture/model/document.js")));
const { defaults } = await import(pathToFileURL(path.join(out, "fixture/shared/contracts.js")));
const doc = emptyDocument();
const source = { ...createObject("shape", { x: 70, y: 150 }, doc.background), id: "source" };
const legacy = { ...createObject("connector", { x: 80, y: 360 }, doc.background), id: "legacy" };
legacy.style = { ...legacy.style, strokeWidth: 12 };
doc.objects = [source, legacy];
const preferences = { ...defaults, styles: { connector: legacy.style } };
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ preferences, recents: [] }));
const file = path.join(out, "Quick-color.axon");
await writeFile(file, JSON.stringify(doc));
const env = { ...process.env, AXON_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  ...(process.env.AXON_EXECUTABLE ? { executablePath: path.resolve(process.env.AXON_EXECUTABLE), args: [file] } : { args: [".", file] }),
  cwd: process.cwd(), env,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const pause = () => page.waitForTimeout(300);
const state = async () => { await pause(); return page.evaluate(() => window.axon.init()); };
const object = (id) => page.locator(`.canvas > g > g[data-object-id="${id}"]`);
async function marker() {
  await object("source").hover();
  const handle = page.locator('[data-object-id="source"][data-connect="right"]');
  await handle.hover();
  return handle;
}
async function undo() {
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+z");
  await pause();
}
try {
  await button("Файл").waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 850));
  assert.equal((await state()).preferences.styles.connector.strokeWidth, 12);
  const handle = await marker();
  // The preview must match the result even with an old 12-unit tool preference.
  assert.equal(await page.locator('.canvas g[opacity="0.35"] path[stroke="#8CACC5"][stroke-width="2"]').count(), 1);
  assert.equal(await page.locator('.canvas g[opacity="0.35"] path[stroke="#8CACC5"][stroke-width="12"]').count(), 0);
  await handle.click();
  await page.getByLabel("Текст объекта").press("Escape");
  let current = await state();
  const created = current.document.objects.at(-1);
  assert.equal(created.type, "connector");
  assert.equal(created.style.strokeWidth, 2);
  assert.equal(await object(created.id).locator('path[stroke="#8CACC5"]').first().getAttribute("stroke-width"), "2");
  assert.equal(current.document.objects.find((o) => o.id === "legacy").style.strokeWidth, 12);
  assert.equal(current.preferences.styles.connector.strokeWidth, 12);
  await page.screenshot({ path: path.join(out, "plus-100.png") });
  await undo();
  assert.deepEqual((await state()).document.objects, doc.objects);
  const dragHandle = await marker();
  const h = await dragHandle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(780, 460, { steps: 8 });
  await page.mouse.up();
  assert.equal((await state()).document.objects.at(-1).style.strokeWidth, 2);
  await undo();
  console.log("PASS node + preview/click/drag at 100% uses 2; saved tool width 12 and legacy object remain; one-step undo");

  await object("source").click();
  await button("Заливка").click();
  const picker = page.getByLabel("Заливка: выбрать произвольный цвет", { exact: true });
  const hex = page.getByRole("textbox", { name: "Заливка HEX", exact: true });
  assert.equal(await picker.getAttribute("type"), "color");
  const p = await picker.boundingBox(), t = await hex.boundingBox();
  assert.equal(p.width, 32);
  assert.equal(p.height, 32);
  assert.ok(p.x + p.width < t.x);
  await picker.focus();
  assert.ok(await picker.evaluate((el) => el === document.activeElement));
  const beforeColor = (await state()).document;
  // Model the native chooser's input previews followed by its final change.
  await picker.evaluate((el) => {
    for (const color of ["#123456", "#234567", "#345678"]) {
      el.value = color;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
  });
  assert.deepEqual((await state()).document, beforeColor);
  await picker.evaluate((el) => el.dispatchEvent(new window.Event("change", { bubbles: true })));
  assert.equal((await state()).document.objects[0].style.fill, "#345678");
  assert.equal(await hex.inputValue(), "#345678");
  await page.screenshot({ path: path.join(out, "full-color-button.png") });
  await page.keyboard.press("Escape");
  await undo();
  assert.deepEqual((await state()).document, beforeColor);
  console.log("PASS full-color control left of HEX, keyboard focus, interim input is clean, final color is one undo action");
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, "results.json"), JSON.stringify({ executable: process.env.AXON_EXECUTABLE ?? "development", passed: true, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
