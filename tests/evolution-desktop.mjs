import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts/evolution");
await mkdir(out, { recursive: true });
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(out, "data-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pause = () => page.waitForTimeout(250);
const state = async () => {
  await pause();
  return page.evaluate(() => window.axon.init());
};
const note = (s) => console.log("PASS " + s);
async function drag(a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await pause();
}
async function canvasFocus() {
  await page.locator(".canvas").focus();
}
async function newTab() {
  await page
    .getByRole("button", { name: "Новая вкладка", exact: true })
    .click();
  await pause();
}
async function saveTo(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await canvasFocus();
  await page.keyboard.press("Control+s");
  await pause();
}
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  assert.equal(await page.locator("aside.inspector").count(), 0);
  for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4]) {
    await newTab();
    // Wheel zoom is anchored in CSS pixels; the stored view reports the resulting camera.
    await page.mouse.move(820, 500);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -Math.log(zoom) / 0.006);
    await page.keyboard.up("Control");
    await pause();
    for (const kind of ["straight", "orthogonal", "curved"]) {
      await page
        .getByRole("button", { name: "Соединение · L", exact: true })
        .click();
      await page.getByRole("button", { name: "Маршрут", exact: true }).click();
      await page.getByRole("button", { name: { straight: "Прямая линия", orthogonal: "Угловая линия", curved: "Плавная линия" }[kind], exact: true }).click();
      await drag({ x: 350, y: 420 }, { x: 700, y: 530 });
      const current = await state();
      const c = current.document.objects.at(-1);
      assert.equal(c.route, kind);
      assert.equal(c.type, "connector");
      assert.ok(
        Math.abs(
          (c.end.x - c.start.x) *
            current.tabs.find((t) => t.sessionId === current.sessionId).view
              .camera.zoom -
            350,
        ) < 1,
      );
      assert.equal(c.style.strokeWidth, 2);
      const width = await page
        .locator(`[data-object-id="${c.id}"] path`)
        .nth(1)
        .getAttribute("stroke-width");
      assert.ok(Number(width) * zoom >= 0.849);
      await canvasFocus();
      await page.keyboard.press("Escape");
      // Select by the route's visible SVG geometry, away from the floating property panel.
      const hit = await page
        .locator(`[data-object-id="${c.id}"] path`)
        .nth(1)
        .evaluate((p) => {
          const q = p.getPointAtLength(p.getTotalLength() * 0.8);
          const m = p.getScreenCTM();
          return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
        });
      await page.mouse.click(hit.x, hit.y);
      assert.equal(await page.locator('[data-end="end"]').count(), 1);
    }
  }
  note(
    "all three routes created and selected at 10%, 25%, 50%, 100%, 200%, 400%; canonical stroke unchanged",
  );
  await newTab();
  await page.getByRole("button", { name: "Фигура · R", exact: true }).click();
  await drag({ x: 300, y: 360 }, { x: 480, y: 460 });
  let current = await state(),
    source = current.document.objects[0];
  await page.mouse.move(390, 400);
  await pause();
  let marker = page.locator(
    `[data-object-id="${source.id}"][data-connect="right"]`,
  );
  await marker.hover();
  await pause();
  assert.equal((await state()).document.objects.length, 1);
  await marker.click();
  await page
    .getByRole("textbox", { name: "Текст объекта" })
    .fill("Следующий узел");
  await page.getByRole("textbox", { name: "Текст объекта" }).press("Escape");
  current = await state();
  assert.equal(current.document.objects.length, 3);
  await canvasFocus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.equal((await state()).document.objects.length, 1);
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  assert.equal((await state()).document.objects.length, 3);
  note(
    "side-marker preview is transient; click creates node and arrow atomically, text is a separate undo",
  );
  await page.getByRole("button", { name: "Карандаш · P", exact: true }).click();
  await drag({ x: 300, y: 530 }, { x: 390, y: 580 });
  await drag({ x: 450, y: 530 }, { x: 520, y: 580 });
  assert.equal(await page.locator(".selection").count(), 0);
  assert.equal(
    await page.getByRole("toolbar", { name: "Свойства выделения" }).count(),
    0,
  );
  assert.equal(
    (await state()).document.objects.filter((o) => o.type === "stroke").length,
    2,
  );
  await page.getByRole("button", { name: "Выбор · V", exact: true }).click();
  assert.equal(await page.locator(".selection").count(), 0);
  await canvasFocus();
  await page.keyboard.press("Control+a");
  assert.equal(await page.locator("[data-scale]").count(), 4);
  const beforeScale = (await state()).document;
  const h = await page.locator('[data-scale][data-handle="se"]').boundingBox();
  await drag(
    { x: h.x + h.width / 2, y: h.y + h.height / 2 },
    { x: h.x + 90, y: h.y + 60 },
  );
  const scaled = (await state()).document;
  assert.ok(scaled.objects[0].w > beforeScale.objects[0].w);
  assert.ok(
    scaled.objects[0].style.fontSize > beforeScale.objects[0].style.fontSize,
  );
  await canvasFocus();
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).document, beforeScale);
  note(
    "pencil stays active without selection; mixed selection scales text and geometry with one undo",
  );
  const aId = (await state()).sessionId;
  await saveTo(path.join(out, "A.axon"));
  await newTab();
  const bId = (await state()).sessionId;
  await page
    .getByRole("button", { name: "Создать mind map", exact: true })
    .click();
  await page.mouse.click(500, 350);
  await page.getByRole("textbox", { name: "Текст объекта" }).fill("Корень");
  await page.getByRole("textbox", { name: "Текст объекта" }).press("Escape");
  await canvasFocus();
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Текст объекта" }).fill("Ветка");
  await page.getByRole("textbox", { name: "Текст объекта" }).press("Escape");
  await canvasFocus();
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Текст объекта" }).fill("Лист");
  await page.getByRole("textbox", { name: "Текст объекта" }).press("Escape");
  const tree = (await state()).document;
  assert.equal(tree.objects.filter((o) => o.mind).length, 3);
  assert.equal(tree.objects.filter((o) => o.mindBranch).length, 2);
  await saveTo(path.join(out, "B.axon"));
  assert.equal(
    JSON.parse(await readFile(path.join(out, "B.axon"), "utf8")).objects.filter(
      (o) => o.mind,
    ).length,
    3,
  );
  await page.getByRole("tab", { name: "A.axon", exact: true }).click();
  assert.equal((await state()).sessionId, aId);
  await page.getByRole("tab", { name: "B.axon", exact: true }).click();
  assert.equal((await state()).sessionId, bId);
  assert.deepEqual((await state()).document, tree);
  note("three-level mind map, save, tab switching and independent content");
  for (const theme of ["dark", "light"]) {
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page.getByLabel("Тема интерфейса").selectOption(theme);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) =>
          BrowserWindow.getAllWindows()[0].setContentSize(w, h),
        [w, h],
      );
      await pause();
      await page.screenshot({ path: path.join(out, `${theme}-${w}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  note("dark/light 1366×768 and 1920×1080 rendered without JavaScript errors");
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ errors, passed: true }, null, 2),
  );
} finally {
  await app.evaluate(({ app }) => app.exit());
}
