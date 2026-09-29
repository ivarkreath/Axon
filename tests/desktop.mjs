import { _electron as electron } from "playwright";
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const output = path.resolve("artifacts");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["tests/harness.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "artifacts/harness.mjs",
});
const helper = await import(
  pathToFileURL(path.join(output, "harness.mjs")).href
);
const font = async (name) =>
  new Uint8Array(await readFile(`public/fonts/${name}.ttf`)).buffer;
helper.registerFonts(
  await font("NotoSans-Regular"),
  await font("NotoSansMono-Regular"),
);
const data = path.join(output, "desktop-data-" + Date.now());
const env = { ...process.env, AXON_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
let app;
const errors = [];
const passed = [];
let page;
const note = (name) => {
  passed.push(name);
  console.log("PASS " + name);
};
const settle = async () => {
  await page.waitForTimeout(350);
};
const state = async () => {
  await settle();
  return page.evaluate(() => window.axon.init());
};
const press = async (key) => {
  await page.keyboard.press(key);
  await settle();
};
async function dialogFile(file, kind = "open") {
  await app.evaluate(
    ({ dialog }, { file, kind }) => {
      if (kind === "open")
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      else
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
    },
    { file, kind },
  );
}
async function openFile(file) {
  await dialogFile(file);
  await page.getByRole("button", { name: "Файл", exact: true }).click();
  await page.getByRole("menuitem", { name: "Открыть…" }).click();
  await settle();
}
try {
  app = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Файл", exact: true })
    .waitFor({ timeout: 30000 });
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      sandbox: p.sandbox,
      nodeIntegration: p.nodeIntegration,
    };
  });
  assert.deepEqual(security, {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  note("sandbox, context isolation, no renderer Node");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  await settle();
  await page.screenshot({ path: path.join(output, "empty-dark-1366.png") });
  const canvas = page.locator(".canvas");
  const box = await canvas.boundingBox();
  await page.getByRole("button", { name: "Фигура · R", exact: true }).click();
  await page.mouse.move(box.x + 150, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 275, { steps: 12 });
  await page.mouse.up();
  await settle();
  let st = await state();
  assert.equal(st.document.objects.length, 1);
  note("drag creates a shape and returns to selection");
  await page.mouse.dblclick(box.x + 245, box.y + 215);
  const text = page.getByRole("textbox", { name: "Текст объекта" });
  await text.fill("Проверка кириллицы\nAPI Gateway");
  await text.press("End");
  await text.press("Space");
  await text.press("Control+A");
  await text.press("ArrowRight");
  await text.press("Backspace");
  await page.screenshot({ path: path.join(output, "text-active-1366.png") });
  await text.press("Escape");
  st = await state();
  assert.equal(st.document.objects.length, 1);
  assert.match(st.document.objects[0].text, /Проверка кириллицы/);
  await page.screenshot({
    path: path.join(output, "text-properties-1366.png"),
  });
  note("Cyrillic text, Enter/Space/Select All/Backspace do not damage canvas");
  const afterText = st.document.objects[0].text;
  await page.mouse.click(box.x + 600, box.y + 500);
  await press("Control+z");
  st = await state();
  assert.equal(st.document.objects[0].text, "");
  await press("Control+Shift+z");
  st = await state();
  assert.equal(st.document.objects[0].text, afterText);
  note("one text session is one undo/redo operation");
  await page.mouse.dblclick(box.x + 245, box.y + 215);
  await text.fill("Проверка кириллицы\nСохранено во время ввода");
  const textSessionFile = path.join(output, "text-session.axon");
  await dialogFile(textSessionFile, "save");
  await text.press("Control+s");
  await text.waitFor({ state: "hidden" });
  await settle();
  assert.equal(
    JSON.parse(await readFile(textSessionFile, "utf8")).objects[0].text,
    "Проверка кириллицы\nСохранено во время ввода",
  );
  note("Save shortcut commits active text and writes it to disk");
  // The fixture contains an actual screenshot from the running application.
  const screenshot = await page.screenshot({
    clip: { x: 0, y: 0, width: 700, height: 420 },
  });
  const image = {
    id: "fixture-image",
    mime: "image/png",
    data: screenshot.toString("base64"),
    width: 700,
    height: 420,
  };
  const fixture = helper.fixture(image);
  const fixtureFile = path.join(output, "acceptance.axon");
  await writeFile(fixtureFile, JSON.stringify(fixture));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await openFile(fixtureFile);
  st = await state();
  assert.equal(st.document.objects.length, fixture.objects.length);
  note("open versioned fixture with embedded screenshot");
  await page
    .getByRole("button", { name: "Показать всё · Shift + 1", exact: true })
    .click();
  await settle();
  await page.screenshot({ path: path.join(output, "scene-dark-1366.png") });
  const client = page.locator('[data-object-id="client"]').first();
  await client.click();
  await press("Control+d");
  st = await state();
  assert.equal(st.document.objects.length, fixture.objects.length + 1);
  const copied = st.document.objects.at(-1);
  assert.notEqual(copied.id, "client");
  await press("Delete");
  st = await state();
  assert.equal(st.document.objects.length, fixture.objects.length);
  await client.click();
  await press("Delete");
  st = await state();
  assert.equal(
    st.document.objects.some((o) => o.id === "api"),
    false,
  );
  await press("Control+z");
  st = await state();
  assert.equal(
    st.document.objects.some((o) => o.id === "api"),
    true,
  );
  note("duplicate IDs, delete cascade, undo restores connector");
  await page.locator('[data-object-id="client"]').first().click();
  await page.keyboard.down("Shift");
  await page.locator('[data-object-id="gateway"]').first().click();
  await page.keyboard.up("Shift");
  await press("Control+g");
  st = await state();
  const members = st.document.objects.filter((o) => o.groupId);
  assert.ok(members.length >= 2);
  await press("Control+d");
  st = await state();
  const groups = new Set(
    st.document.objects.filter((o) => o.groupId).map((o) => o.groupId),
  );
  assert.equal(groups.size, 2);
  await press("Control+z");
  note("flat grouping and duplicate create independent groups");
  // Move selected group using keyboard and inspect logical attachment geometry in the file model.
  await page.locator('[data-object-id="client"]').first().click();
  const before = (await state()).document;
  await press("Shift+ArrowRight");
  const moved = (await state()).document;
  assert.equal(
    moved.objects.find((o) => o.id === "client").x,
    before.objects.find((o) => o.id === "client").x + 10,
  );
  assert.deepEqual(
    moved.objects.find((o) => o.id === "api").start,
    before.objects.find((o) => o.id === "api").start,
  );
  note("group nudge preserves logical connector attachment");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема интерфейса").selectOption("light");
  await settle();
  await page.screenshot({ path: path.join(output, "settings-light-1366.png") });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.screenshot({ path: path.join(output, "scene-light-1366.png") });
  assert.deepEqual((await state()).document, moved);
  note("theme changes do not modify document colors or content");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080),
  );
  await page
    .getByRole("button", { name: "Показать всё · Shift + 1", exact: true })
    .click();
  await settle();
  await page.screenshot({ path: path.join(output, "scene-light-1920.png") });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема интерфейса").selectOption("dark");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.screenshot({ path: path.join(output, "scene-dark-1920.png") });
  // Save/Open tests use native dialog stubs only; the app's actual IPC, validation and disk writes run.
  const savedFile = path.join(output, "roundtrip.axon");
  await dialogFile(savedFile, "save");
  await press("Control+Shift+s");
  st = await state();
  assert.equal(st.dirty, false);
  assert.ok((await readFile(savedFile, "utf8")).includes(image.data));
  await openFile(savedFile);
  st = await state();
  assert.ok(st.document.assets["fixture-image"]);
  note("safe save/open includes screenshot bytes independently of original");
  const invalid = path.join(output, "invalid.axon");
  await writeFile(invalid, '{"version":999}');
  const beforeInvalid = st.document;
  await openFile(invalid);
  assert.deepEqual((await state()).document, beforeInvalid);
  assert.equal(
    await page.getByRole("alert").innerText(),
    "Эта версия формата Axon пока не поддерживается.",
  );
  await page.screenshot({ path: path.join(output, "error-1920.png") });
  await page.getByRole("button", { name: "Закрыть уведомление" }).click();
  note("unsupported file does not replace current work");
  // Native clipboard roundtrip.
  await page.locator('[data-object-id="note"]').first().click();
  await press("Control+c");
  await press("Control+v");
  st = await state();
  assert.equal(st.document.objects.length, beforeInvalid.objects.length + 1);
  await press("Control+z");
  note("system clipboard copies Axon objects with new IDs");
  await app.evaluate(async ({ clipboard }) => {
    await clipboard.writeText("Текст из системного буфера");
  });
  await press("Control+v");
  st = await state();
  assert.ok(
    st.document.objects.some((o) => o.text === "Текст из системного буфера"),
  );
  await press("Control+z");
  note("plain text clipboard insertion");
  await app.evaluate(async ({ clipboard, ClipboardItem }, data) => {
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([Buffer.from(data, "base64")], {
          type: "image/png",
        }),
      }),
    ]);
  }, image.data);
  await press("Control+v");
  st = await state();
  assert.equal(st.document.objects.filter((o) => o.type === "image").length, 2);
  await press("Control+z");
  note("system image clipboard insertion");
  // File image import, then remove source and reopen project.
  const sourceImage = path.join(output, "source-image.png");
  await writeFile(sourceImage, screenshot);
  await dialogFile(sourceImage);
  await page
    .getByRole("button", {
      name: "Вставить изображение · Ctrl/Cmd + Shift + I",
      exact: true,
    })
    .click();
  await settle();
  assert.equal(
    (await state()).document.objects.filter((o) => o.type === "image").length,
    2,
  );
  await press("Control+s");
  await rm(sourceImage);
  await openFile(savedFile);
  assert.equal(
    (await state()).document.objects.filter((o) => o.type === "image").length,
    2,
  );
  note("image dialog import survives source deletion and save/open");
  // Return to the composed fixture after verifying the deliberately overlapping image import.
  await openFile(fixtureFile);
  // Export each format through the UI and narrow IPC to actual files.
  await page.locator('[data-object-id="note"]').first().click();
  for (const scope of ["all", "selection"])
    for (const format of ["png", "svg", "pdf"]) {
      await page.getByRole("button", { name: "Экспорт", exact: true }).click();
      await page
        .getByRole("button", { name: new RegExp("^" + format.toUpperCase()) })
        .click();
      await page.getByLabel("Область").selectOption(scope);
      const target = path.join(output, `export-${scope}.${format}`);
      await dialogFile(target, "save");
      await page
        .getByRole("button", { name: "Сохранить экспорт", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .waitFor({ state: "hidden", timeout: 30000 });
      assert.ok((await readFile(target)).length > 100);
      note(`${format.toUpperCase()} ${scope} exported`);
    }
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await settle();
  await page.screenshot({ path: path.join(output, "export-dialog-1920.png") });
  await page.getByRole("button", { name: "Как PNG", exact: true }).click();
  await settle();
  assert.equal(
    await app.evaluate(async ({ clipboard }) => clipboard.has("image/png")),
    true,
  );
  note("copy as PNG to native clipboard");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await page.getByRole("button", { name: /^PNG/ }).click();
  await page.getByLabel("Область").selectOption("selection");
  await page.getByLabel("Масштаб").selectOption("1");
  await page.getByLabel("Прозрачный фон").check();
  await dialogFile(path.join(output, "export-transparent-1x.png"), "save");
  await page
    .getByRole("button", { name: "Сохранить экспорт", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  note("transparent PNG at 1× exported");
  // Pending changes must prompt; Cancel must preserve them.
  await page.locator('[data-object-id="note"]').first().click();
  await press("ArrowRight");
  const dirtyDoc = (await state()).document;
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 2,
      checkboxChecked: false,
    });
  });
  await press("Control+n");
  assert.deepEqual((await state()).document, dirtyDoc);
  note("Cancel New retains dirty document");
  await page.waitForTimeout(1200);
  const recovery = JSON.parse(
    await readFile(path.join(data, "recovery.json"), "utf8"),
  );
  assert.deepEqual(recovery.document, dirtyDoc);
  note("debounced recovery is written to disk separately from manual save");
  // 400 shapes: record frame intervals during real pointer pan; no claimed FPS target.
  const stress = helper.fixture();
  stress.title = "400 объектов";
  stress.objects = [];
  for (let i = 0; i < 400; i++) {
    const o = structuredClone(fixture.objects.find((o) => o.id === "client"));
    o.id = "stress-" + i;
    o.x = (i % 20) * 230;
    o.y = Math.floor(i / 20) * 150;
    o.text = `Сервис ${i + 1}`;
    stress.objects.push(o);
  }
  const stressFile = path.join(output, "stress.axon");
  await writeFile(stressFile, JSON.stringify(stress));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await openFile(stressFile);
  await page.getByTitle("Масштаб 100%", { exact: true }).click();
  await settle();
  // The automation host can cover the window. Measure rendering without Chromium's
  // intentional 1 Hz background throttle, and record that test-only condition.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.evaluate(() => {
    window.__axonFrames = [];
    let last = performance.now();
    window.__axonMeasuring = true;
    function frame(now) {
      window.__axonFrames.push(now - last);
      last = now;
      if (window.__axonMeasuring) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.keyboard.down("Space");
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(1100, 750, { steps: 50 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const frameTimes = await page.evaluate(() => {
    window.__axonMeasuring = false;
    return window.__axonFrames.slice(2);
  });
  await page.screenshot({ path: path.join(output, "stress-400.png") });
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const performanceResult = {
    objects: 400,
    samples: sorted.length,
    medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
    p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
    maxFrameMs: sorted.at(-1),
    window: "1920×1080 CSS",
    platform: process.platform,
    backgroundThrottling: false,
  };
  await writeFile(
    path.join(output, "performance.json"),
    JSON.stringify(performanceResult, null, 2),
  );
  note("400-object pan measured: " + JSON.stringify(performanceResult));
  await openFile(savedFile);
  assert.equal(errors.length, 0, errors.join("\n"));
  note("no renderer runtime errors");
  await writeFile(
    path.join(output, "desktop-results.json"),
    JSON.stringify({ passed, errors, performance: performanceResult }, null, 2),
  );
  console.log(`Desktop checks complete: ${passed.length}`);
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    console.log("RENDERER ERRORS", errors);
    console.log((await page.locator("body").innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
