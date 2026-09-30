import { _electron as electron } from "playwright";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const out = path.resolve("artifacts/controls");
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["src/model/document.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(out, "model.mjs"),
});
const { emptyDocument, createObject } = await import(
  pathToFileURL(path.join(out, "model.mjs")).href
);
const doc = emptyDocument();
const a = {
  ...createObject("shape", { x: 30, y: 80 }, doc.background),
  id: "a",
  text: "Сервис А",
};
const b = {
  ...createObject("shape", { x: 490, y: 80 }, doc.background),
  id: "b",
  text: "Сервис Б",
};
b.style = { ...b.style, radius: 0, fill: "#AACFEA", color: "#202B38" };
const text = {
  ...createObject("text", { x: 30, y: 320 }, doc.background),
  id: "text",
  text: "Текст на холсте",
};
const c = {
  ...createObject("connector", { x: 0, y: 0 }, doc.background),
  id: "c",
  route: "straight",
  start: { type: "bound", nodeId: "a", side: "right" },
  end: { type: "bound", nodeId: "b", side: "left" },
};
const reverse = {
  ...createObject("connector", { x: 650, y: 310 }, doc.background),
  id: "reverse",
  route: "straight",
  end: { type: "free", x: 360, y: 310 },
};
const vertical = {
  ...createObject("connector", { x: 740, y: 60 }, doc.background),
  id: "vertical",
  route: "straight",
  end: { type: "free", x: 740, y: 340 },
};
doc.objects = [a, b, text, c, reverse, vertical];
const file = path.join(out, "Controls.axon");
await writeFile(file, JSON.stringify(doc));
const executable = process.env.AXON_EXECUTABLE;
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(out, "profile-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  ...(executable
    ? { executablePath: path.resolve(executable), args: [file] }
    : { args: [".", file] }),
  cwd: process.cwd(),
  env,
});
const page = await app.firstWindow();
const errors = [],
  passed = [];
page.on("pageerror", (e) => errors.push(e.message));
const pause = () => page.waitForTimeout(350);
const button = (name) => page.getByRole("button", { name, exact: true });
const object = (id) => page.locator(`.canvas > g > g[data-object-id="${id}"]`);
const state = async () => {
  await pause();
  return page.evaluate(() => window.axon.init());
};
const note = (text) => {
  console.log("PASS " + text);
  passed.push(text);
};
const canvasFocus = () => page.locator(".canvas").focus();
async function choose(id, modifiers) {
  const node = object(id);
  if (["c", "reverse", "vertical"].includes(id)) {
    const p = await node
      .locator('path[stroke="transparent"]')
      .evaluate((el) => {
        const p = el.getPointAtLength(el.getTotalLength() / 2),
          m = el.getScreenCTM();
        return {
          x: p.x * m.a + p.y * m.c + m.e,
          y: p.x * m.b + p.y * m.d + m.f,
        };
      });
    for (const key of modifiers ?? []) await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    for (const key of modifiers ?? []) await page.keyboard.up(key);
  } else await node.click({ modifiers });
  await pause();
}
async function inside(locator) {
  const r = await locator.boundingBox(),
    v = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
  assert.ok(
    r &&
      r.x >= 11 &&
      r.y >= 11 &&
      r.x + r.width <= v.w - 11 &&
      r.y + r.height <= v.h - 11,
    JSON.stringify({ r, v }),
  );
}
async function palette(label) {
  await button(label).click();
  await inside(page.locator(".property-popup"));
  const geometry = await page.locator(".swatches button").evaluateAll((nodes) =>
    nodes.map((node) => {
      const hit = node.getBoundingClientRect(),
        disc = node.querySelector(".swatch-disc").getBoundingClientRect();
      return {
        hit: { x: hit.x, y: hit.y, w: hit.width, h: hit.height },
        disc: { w: disc.width, h: disc.height },
      };
    }),
  );
  for (const { hit, disc } of geometry) {
    assert.equal(hit.w, 34);
    assert.equal(hit.h, 34);
    assert.equal(disc.w, 22);
    assert.equal(disc.h, 22);
  }
  assert.ok(new Set(geometry.map((g) => g.hit.y)).size >= 2);
  await page.screenshot({
    path: path.join(out, `palette-${label.replace(/[^а-яА-Яa-z]/g, "-")}.png`),
  });
}
async function pick(label, option) {
  await button(label).click();
  assert.equal(await page.locator(".property-popup").count(), 1);
  assert.equal(await page.locator(".property-popup select").count(), 0);
  await button(option).click();
  assert.equal(await page.locator(".property-popup").count(), 0);
}
async function undo() {
  await canvasFocus();
  await page.keyboard.press("Control+z");
  await pause();
}
async function redo() {
  await canvasFocus();
  await page.keyboard.press("Control+y");
  await pause();
}
try {
  await button("Файл").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 850),
  );
  await choose("a");
  await palette("Заливка");
  const original = (await state()).document;
  await page.getByRole("textbox", { name: "Заливка HEX" }).fill("#xyz123");
  assert.equal(await button("Применить цвет").isDisabled(), true);
  assert.deepEqual((await state()).document, original);
  await button("Заливка #F1D58A").click();
  assert.equal(
    await button("Заливка #F1D58A").getAttribute("aria-pressed"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await button("Заливка").evaluate((el) => el === document.activeElement),
    true,
  );
  await undo();
  assert.deepEqual((await state()).document, original);
  await redo();
  await choose("a");
  await pick("Стиль линии", "Пунктирная обводка");
  await pick("Углы", "Мягкие углы");
  await palette("Обводка");
  await page.keyboard.press("Escape");
  await button("Углы").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".property-popup").count(), 1);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await button("Скруглённые углы").evaluate(
      (el) => el === document.activeElement,
    ),
    true,
  );
  await page.keyboard.press("Space");
  assert.equal(
    (await state()).document.objects.find((o) => o.id === "a").style.radius,
    12,
  );
  await button("Заливка").click();
  await button("Обводка").click();
  assert.equal(await page.locator(".property-popup").count(), 1);
  await button("Обводка").click();
  assert.equal(await page.locator(".property-popup").count(), 0);
  note(
    "round palette, invalid HEX, selected color, one-step undo, direct icon pickers, exclusive opening, keyboard and focus return",
  );

  await choose("b", ["Shift"]);
  assert.equal(await page.locator(".selection [data-scale]").count(), 4);
  await pick("Углы · Разные", "Прямые углы");
  assert.ok(
    (await state()).document.objects
      .filter((o) => ["a", "b"].includes(o.id))
      .every((o) => o.style.radius === 0),
  );
  await palette("Заливка · Разные");
  await page.keyboard.press("Escape");
  const scale = await page
    .locator('.selection [data-handle="se"]')
    .boundingBox();
  const beforeScale = (await state()).document;
  await page.mouse.move(scale.x + scale.width / 2, scale.y + scale.height / 2);
  await page.mouse.down();
  await page.mouse.move(scale.x + 30, scale.y + 20, { steps: 6 });
  await page.mouse.up();
  assert.notDeepEqual((await state()).document, beforeScale);
  await undo();
  assert.deepEqual((await state()).document, beforeScale);
  note(
    "mixed corners apply to both shapes; shared selection frame and composition resize remain functional",
  );

  await choose("text");
  await object("text").dblclick();
  const edit = page.getByRole("textbox", { name: "Текст объекта" });
  await edit.evaluate((el) => {
    el.focus();
    el.setSelectionRange(2, 7);
  });
  await palette("Цвет текста");
  await button("Цвет текста #83CEFF").click();
  assert.equal(await edit.count(), 1);
  assert.deepEqual(
    await edit.evaluate((el) => [el.selectionStart, el.selectionEnd]),
    [2, 7],
  );
  await page.keyboard.press("Escape");
  await pick("Выравнивание текста", "По центру");
  assert.deepEqual(
    await edit.evaluate((el) => [el.selectionStart, el.selectionEnd]),
    [2, 7],
  );
  await edit.focus();
  await edit.press("Escape");
  note("text color/alignment preserve editing and selected text");

  await choose("c");
  assert.equal(
    await page.locator(".selection rect:not([data-end])").count(),
    0,
  );
  assert.equal(await page.locator(".selection [data-end]").count(), 2);
  const connectionBefore = (await state()).document.objects.find(
    (o) => o.id === "c",
  );
  for (const [option, route] of [
    ["Угловая линия", "orthogonal"],
    ["Плавная линия", "curved"],
    ["Прямая линия", "straight"],
  ]) {
    await pick("Маршрут", option);
    const after = (await state()).document.objects.find((o) => o.id === "c");
    assert.deepEqual(after, { ...connectionBefore, route });
  }
  for (const [id, start, end] of [
    ["c", "Контурный круг", "Контурный ромб"],
    ["reverse", "Контурный треугольник", "Открытая стрелка"],
    ["vertical", "Обычная стрелка", "Контурный круг"],
  ]) {
    await choose(id);
    await pick("Начало линии", start);
    await pick("Конец линии", end);
    assert.equal(
      await page.locator(".selection rect:not([data-end])").count(),
      0,
    );
  }
  await choose("c");
  await palette("Обводка");
  await page.keyboard.press("Escape");
  await button("Конец линии").click();
  await page.screenshot({ path: path.join(out, "endings-picker.png") });
  await page.keyboard.press("Escape");
  const endHandle = await page
    .locator('.selection [data-end="end"]')
    .boundingBox();
  await page.mouse.move(
    endHandle.x + endHandle.width / 2,
    endHandle.y + endHandle.height / 2,
  );
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(780, 460, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  assert.equal(
    (await state()).document.objects.find((o) => o.id === "c").end.type,
    "free",
  );
  await undo();
  note(
    "three routes retain endpoints, six endings render on horizontal/reverse/vertical connections, endpoint rebinding and undo",
  );

  await button("Соединение · L").click();
  await page.mouse.move(440, 670);
  await page.mouse.down();
  await page.mouse.move(690, 700, { steps: 5 });
  assert.equal(
    await page.locator(".selection rect:not([data-end])").count(),
    0,
  );
  await page.screenshot({ path: path.join(out, "creating-connection.png") });
  await page.mouse.up();
  assert.equal(
    await page.locator(".selection rect:not([data-end])").count(),
    0,
  );
  await undo();
  for (const zoom of [0.25, 0.5, 1, 2]) {
    await page.getByTitle("Масштаб 100%", { exact: true }).click();
    await canvasFocus();
    await page.mouse.move(500, 360);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -Math.log(zoom) / 0.006);
    await page.keyboard.up("Control");
    await pause();
    await button("Соединение · L").click();
    await palette("Обводка");
    assert.equal(
      Math.round(
        (await page.locator(".context-properties").boundingBox()).height,
      ),
      44,
    );
    await page.screenshot({ path: path.join(out, `zoom-${zoom}.png`) });
    await page.keyboard.press("Escape");
  }
  await page.getByTitle("Масштаб 100%", { exact: true }).click();
  for (const factor of [1, 1.25, 1.5, 2]) {
    await app.evaluate(({ BrowserWindow }, factor) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(984, 700);
      w.webContents.setZoomFactor(factor);
    }, factor);
    await pause();
    await palette("Обводка");
    const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    await writeFile(path.join(out, `ui-scale-${factor}.png`), Buffer.from(capture, "base64"));
    await page.keyboard.press("Escape");
  }
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.setZoomFactor(1);
    w.setContentSize(1366, 850);
  });
  await pause();
  note(
    "creation has no box; palette stays 22/34 CSS px at canvas 25/50/100/200% and emulated UI 100/125/150/200%",
  );

  await button("Выбор · V").click();
  await page
    .locator(".canvas")
    .click({ button: "right", position: { x: 1320, y: 680 } });
  const beforeBackground = (await state()).document;
  const beforePreferences = (await state()).preferences;
  await page.getByRole("menuitem", { name: "Тема", exact: true }).hover();
  await page
    .getByRole("menuitemcheckbox", { name: "Графитовая", exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(out, "theme-submenu.png") });
  await page
    .getByRole("menuitem", { name: "Другой цвет…", exact: true })
    .click();
  await inside(page.locator(".property-popup"));
  await page.keyboard.press("Escape");
  assert.deepEqual((await state()).document, beforeBackground);
  await page
    .locator(".canvas")
    .click({ button: "right", position: { x: 1320, y: 680 } });
  await page.getByRole("menuitem", { name: "Тема", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("menuitem", { name: "Другой цвет…", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Фон документа HEX" })
    .fill("#294154");
  await button("Применить цвет").click();
  await page.keyboard.press("Escape");
  assert.equal((await state()).document.background, "#294154");
  assert.deepEqual((await state()).document.objects, beforeBackground.objects);
  assert.deepEqual((await state()).preferences, beforePreferences);
  await undo();
  assert.equal(
    (await state()).document.background,
    beforeBackground.background,
  );
  await redo();
  assert.equal((await state()).document.background, "#294154");
  const saved = (await state()).document;
  await canvasFocus();
  await page.keyboard.press("Control+s");
  await pause();
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), saved);
  await page.keyboard.press("Control+n");
  await pause();
  assert.equal((await state()).document.background, "#181C22");
  await page.keyboard.press("Control+w");
  await pause();
  assert.equal((await state()).document.background, "#294154");
  await page.keyboard.press("Control+w");
  await pause();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await canvasFocus();
  await page.keyboard.press("Control+o");
  await pause();
  assert.deepEqual((await state()).document, saved);
  note(
    "Theme submenu hover/keyboard/edge placement, cancel is clean, HEX background is document-local, undo/redo/tabs/save/reopen",
  );
  await canvasFocus(); await page.keyboard.press("Shift+1"); await pause();
  for (const format of ["svg", "png", "pdf"]) {
    const target = path.join(out, `endings.${format}`);
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, target);
    await button("Экспорт").click();
    await page.getByRole("button", { name: new RegExp("^" + format.toUpperCase()) }).click();
    await page.getByLabel("Область").selectOption("all");
    await button("Сохранить экспорт").click();
    await page.getByRole("dialog", { name: "Экспорт схемы" }).waitFor({ state: "hidden" });
    assert.ok((await readFile(target)).length > 500);
  }
  note("new endings exported through the real UI to SVG, PNG and PDF");
  await choose("c");
  await page.screenshot({ path: path.join(out, "final-scene.png") });
  await button("Настройки").click(); await page.getByLabel("Тема интерфейса").selectOption("light"); await button("Закрыть").click();
  await palette("Обводка"); await page.screenshot({ path: path.join(out, "palette-light.png") }); await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        executable: await app.evaluate(() => process.execPath),
        passed,
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png") });
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
