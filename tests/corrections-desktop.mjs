import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts/corrections");
await mkdir(out, { recursive: true });
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(out, "profile-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
const page = await app.firstWindow();
// Explicit diagnostic mode for hosts whose OS clipboard is unavailable.
// The default run always exercises the native clipboard.
const memoryClipboard = process.env.AXON_TEST_MEMORY_CLIPBOARD === "1";
if (memoryClipboard) {
  console.log("ISOLATED MODE: native clipboard is not verified in this run");
  await app.evaluate(({ clipboard }) => {
    let value = "";
    clipboard.writeText = async (text) => {
      value = text;
    };
    clipboard.readText = async () => value;
    clipboard.read = async () => [];
  });
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pause = () => page.waitForTimeout(200);
const state = async () => {
  await pause();
  return page.evaluate(() => window.axon.init());
};
const note = (s) => console.log("PASS " + s);
const button = (name) => page.getByRole("button", { name, exact: true });
const focus = () => page.locator(".canvas").focus();
async function key(k) {
  await focus();
  await page.keyboard.press(k);
  await pause();
}
async function drag(a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await pause();
}
const object = (id) => page.locator(`g[data-object-id="${id}"]`).first();
async function choose(id) {
  const b = await object(id).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await pause();
}
async function text(value) {
  await page.getByLabel("Текст объекта", { exact: true }).fill(value);
  await page.getByLabel("Текст объекта", { exact: true }).press("Escape");
  await pause();
}
async function fresh() {
  await button("Новая вкладка").click();
  await pause();
}
async function save(file) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, file);
  await key("Control+Shift+s");
}
async function open(file) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, file);
  await key("Control+o");
}
async function zoom(value) {
  const s = await state(),
    current = s.tabs.find((t) => t.sessionId === s.sessionId).view.camera.zoom;
  await page.mouse.move(800, 400);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -Math.log(value / current) / 0.006);
  await page.keyboard.up("Control");
  await pause();
}
async function checkPanel(label) {
  const p = page.getByRole("toolbar", { name: label, exact: true });
  const b = await p.boundingBox();
  assert.ok(b && b.height <= 45, JSON.stringify(b));
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  assert.ok(b.x >= 12 && b.x + b.width <= viewport.width - 12);
  if (label === "Стиль создания") {
    const dock = await page
      .getByRole("toolbar", { name: "Инструменты", exact: true })
      .boundingBox();
    assert.ok(b.y + b.height < dock.y && dock.y - b.y - b.height <= 14);
    assert.ok(Math.abs(b.x + b.width / 2 - (dock.x + dock.width / 2)) < 2);
  }
}
try {
  await button("Файл").waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(600, 400); // Test-only: exercise responsive layout below the native minimum.
    win.setContentSize(1366, 768);
  });
  await pause();
  assert.equal(await page.getByLabel("Название документа").count(), 0);
  assert.match(await page.title(), /Без названия — Axon/);
  for (const tool of [
    "Карандаш · P",
    "Текст · T",
    "Соединение · L",
    "Фигура · R",
    "Создать mind map",
  ]) {
    await button(tool).click();
    await pause();
    await checkPanel("Стиль создания");
    if (tool === "Карандаш · P")
      assert.equal(await button("Стиль линии").count(), 0);
  }
  assert.equal((await state()).document.objects.length, 0);
  await page.mouse.click(640, 350);
  await text("Архитектура Axon");
  let s = await state(),
    root = s.document.objects.find((o) => o.mind).id;
  assert.equal(s.document.objects.length, 1);
  await button("Добавить тему справа").click();
  await text("Редактор");
  s = await state();
  const right = s.document.objects.find((o) => o.text === "Редактор").id;
  await key("Tab");
  await text("Жесты и координаты");
  const leaf = (await state()).document.objects.find(
    (o) => o.text === "Жесты и координаты",
  ).id;
  await key("Enter");
  await text("История\nОтмена и повтор");
  await choose(root);
  await button("Добавить тему слева").click();
  await text("Документы");
  const left = (await state()).document.objects.find(
    (o) => o.text === "Документы",
  ).id;
  await key("Tab");
  await text("Сохранение и экспорт");
  s = await state();
  assert.equal(s.document.objects.filter((o) => o.mind).length, 6);
  assert.ok(
    s.document.objects
      .filter((o) => o.mindBranch)
      .every(
        (o) =>
          o.route === "curved" &&
          o.arrows === "none" &&
          o.style.strokeWidth === 1.5,
      ),
  );
  assert.ok(
    s.document.objects
      .filter((o) => o.mind)
      .every((o) => o.style.fill === "none" && o.style.strokeWidth === 0),
  );
  await choose(right);
  await checkPanel("Свойства выделения");
  const beforeMove = (await state()).document;
  const rb = await object(right).boundingBox();
  await drag(
    { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
    { x: rb.x + rb.width / 2 + 30, y: rb.y + rb.height / 2 + 50 },
  );
  const moved = (await state()).document;
  const delta =
    moved.objects.find((o) => o.id === right).y -
    beforeMove.objects.find((o) => o.id === right).y;
  assert.ok(delta > 20);
  assert.ok(
    Math.abs(
      moved.objects.find((o) => o.id === leaf).y -
        beforeMove.objects.find((o) => o.id === leaf).y -
        delta,
    ) < 1e-8,
  );
  assert.deepEqual(
    moved.objects.find((o) => o.id === left),
    beforeMove.objects.find((o) => o.id === left),
  );
  await key("Control+c");
  for (let attempt = 0; attempt < 25; attempt++) {
    const data = await page.evaluate(() => window.axon.readClipboard());
    if (data.document?.objects.some((o) => o.id === right)) break;
    assert.ok(
      attempt < 24,
      "Copied subtree did not reach the clipboard; check native clipboard availability",
    );
    await pause();
  }
  await key("Control+v");
  for (let attempt = 0; attempt < 25; attempt++) {
    if (
      (await state()).document.objects.some(
        (o) => o.mind?.parentId === null && o.id !== root,
      )
    )
      break;
    await pause();
  }
  s = await state();
  const copiedRoot = s.document.objects.find(
    (o) => o.mind?.parentId === null && o.id !== root,
  );
  assert.ok(copiedRoot);
  await key("Delete");
  await key("Control+z");
  await key("Control+Shift+z");
  assert.equal(
    (await state()).document.objects.filter((o) => o.mind).length,
    6,
  );
  await choose(right);
  await key("Delete");
  assert.equal(
    (await state()).document.objects.filter((o) => o.mind).length,
    3,
  );
  await key("Control+z");
  assert.equal(
    (await state()).document.objects.filter((o) => o.mind).length,
    6,
  );
  note(
    "mind map click/left/right/Tab/Enter, subtree move/copy/delete/undo/redo",
  );
  await choose(root);
  await object(root).dblclick();
  const edit = page.getByLabel("Текст объекта", { exact: true });
  await edit.fill("Русская тема\nДлинный многострочный текст");
  await page
    .getByRole("combobox", { name: "Шрифт", exact: true })
    .selectOption("mono");
  await button("Цвет текста").click();
  await button("Цвет текста #83CEFF").click();
  assert.equal(await edit.count(), 1);
  await button("Цвет текста").click();
  await button("Выравнивание текста").click();
  await button("По центру").click();
  await edit.focus();
  await edit.press("End");
  await edit.press("Enter");
  await edit.press("Space");
  const beforeTextClipboard = await edit.inputValue();
  const count = (await state()).document.objects.length;
  await edit.press("Control+a");
  await edit.press("Control+c");
  await edit.press("Delete");
  await edit.press("Control+v");
  assert.equal((await state()).document.objects.length, count);
  if (memoryClipboard) {
    console.log(
      "SKIP native textarea clipboard round trip: isolated mode; object shortcut isolation still checked",
    );
    await edit.fill(beforeTextClipboard);
  } else assert.equal(await edit.inputValue(), beforeTextClipboard);
  await edit.press("Escape");
  await pause();
  await checkPanel("Свойства выделения");
  const mapFile = path.join(out, "Mind map.axon");
  await save(mapFile);
  const savedMap = JSON.parse(await readFile(mapFile, "utf8"));
  assert.equal(savedMap.version, 3);
  assert.ok(savedMap.objects.some((o) => o.text?.includes("Русская тема")));
  note(
    "Russian multiline editing, font/color/alignment focus, native text keys, v3 save",
  );
  await page.screenshot({ path: path.join(out, "mindmap-dark-1366.png") });
  // Mixed scene, multiple zooms and canonical widths on fresh arrows.
  await fresh();
  for (const z of [1, 0.25, 0.5, 2]) {
    await zoom(z);
    await button("Фигура · R").click();
    await drag({ x: 280, y: 230 }, { x: 430, y: 310 });
    await button("Фигура · R").click();
    await drag({ x: 650, y: 230 }, { x: 800, y: 310 });
    await button("Соединение · L").click();
    await drag({ x: 430, y: 270 }, { x: 650, y: 270 });
    s = await state();
    const c = s.document.objects.at(-1);
    assert.equal(c.style.strokeWidth, 2);
    assert.equal(c.start.type, "bound");
    assert.equal(c.end.type, "bound");
    const paths = object(c.id).locator("path");
    assert.equal(await paths.nth(2).getAttribute("stroke"), "none");
    const visibleWidth =
      Number(await paths.nth(1).getAttribute("stroke-width")) * z;
    assert.ok(
      visibleWidth >= 0.85 - 1e-6 &&
        visibleWidth <= Math.max(0.85, 2 * z) + 1e-6,
    );
    await key("Escape");
    await choose(c.start.nodeId);
    const b = await object(c.start.nodeId).boundingBox();
    await drag({ x: b.x + 45, y: b.y + 35 }, { x: b.x + 45, y: b.y + 70 });
    const handle = await page.locator('[data-handle="se"]').boundingBox();
    await drag(
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      {
        x: handle.x + handle.width / 2 + 25,
        y: handle.y + handle.height / 2 + 15,
      },
    );
    assert.deepEqual(
      (await state()).document.objects.find((o) => o.id === c.id).start,
      c.start,
    );
    await page.screenshot({ path: path.join(out, `arrows-${z * 100}.png`) });
    if (z !== 2) await fresh();
  }
  note(
    "arrows created at 25/50/100/200%, width=2, filled heads, move/resize attachments",
  );
  const arrowsFile = path.join(out, "Arrows.axon");
  await save(arrowsFile);
  s = await state();
  const beforeZoom = JSON.stringify(s.document);
  await zoom(0.25);
  await zoom(2);
  assert.equal(JSON.stringify((await state()).document), beforeZoom);
  assert.equal((await state()).dirty, false);
  const legacy = JSON.parse(beforeZoom);
  legacy.version = 2;
  legacy.objects.find((o) => o.type === "connector").style.strokeWidth = 12;
  const legacyFile = path.join(out, "Legacy.axon");
  await writeFile(legacyFile, JSON.stringify(legacy));
  await open(legacyFile);
  s = await state();
  assert.equal(
    s.tabs.find((t) => t.sessionId === s.sessionId).view.camera.zoom,
    1,
  );
  assert.equal(
    s.document.objects.find((o) => o.type === "connector").style.strokeWidth,
    12,
  );
  await key("Control+w");
  await page.getByRole("tab", { name: "Mind map.axon", exact: true }).click();
  await pause();
  await key("Control+w");
  await open(mapFile);
  assert.deepEqual((await state()).document, savedMap);
  note(
    "zoom round trip stays clean, legacy width preserved, files open at 100%, map round trip",
  );
  for (const format of ["png", "svg", "pdf"]) {
    await button("Экспорт").click();
    await page
      .getByRole("button", { name: new RegExp("^" + format.toUpperCase()) })
      .click();
    await page.getByLabel("Область").selectOption("all");
    const file = path.join(out, `mindmap.${format}`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, file);
    await button("Сохранить экспорт").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.ok((await readFile(file)).length > 100);
  }
  note("mind map exported through UI to PNG/SVG/PDF");
  await button("Показать всё · Shift + 1").click();
  await choose(root);
  for (const theme of ["dark", "light"]) {
    const beforeTheme = JSON.stringify((await state()).document);
    await button("Настройки").click();
    await page.getByLabel("Тема интерфейса").selectOption(theme);
    await button("Закрыть").click();
    assert.equal(JSON.stringify((await state()).document), beforeTheme);
    if (theme === "light") {
      const light = {
        ...savedMap,
        background: "#F7F8FA",
        objects: savedMap.objects.map((o) => ({
          ...o,
          style: { ...o.style, color: "#202B38", stroke: "#596A7B" },
        })),
      };
      const file = path.join(out, "Mind map light.axon");
      await writeFile(file, JSON.stringify(light));
      await open(file);
    }
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [800, 600],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) =>
          BrowserWindow.getAllWindows()[0].setContentSize(w, h),
        [w, h],
      );
      await pause();
      if (w < 900) {
        await button("Масштаб и навигация").click();
        await page.getByRole("menuitem", { name: "Показать всё" }).click();
      } else await button("Показать всё · Shift + 1").click();
      await pause();
      await choose(root);
      await checkPanel("Свойства выделения");
      await page.screenshot({
        path: path.join(out, `mindmap-${theme}-${w}.png`),
      });
    }
  }
  assert.deepEqual(errors, []);
  note(
    "real-window screenshots and single-row panel bounds at 1366/1920/800 in both themes",
  );
} catch (e) {
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
