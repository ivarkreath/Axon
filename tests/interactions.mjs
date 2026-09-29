import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts");
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(out, "interactions-data-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  args: [".", path.join(out, "acceptance.axon")],
  cwd: process.cwd(),
  env,
});
const page = await app.firstWindow();
const passed = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = () => page.waitForTimeout(300);
const state = async () => {
  await settle();
  return page.evaluate(() => window.axon.init());
};
const note = (s) => {
  passed.push(s);
  console.log("PASS " + s);
};
async function bounds(id) {
  return page.locator(`[data-object-id="${id}"]`).first().boundingBox();
}
async function drag(a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 16 });
  await page.mouse.up();
  await settle();
}
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  await page
    .getByRole("button", { name: "Показать всё · Shift + 1", exact: true })
    .click();
  await settle();
  let c = await bounds("client"),
    service = await bounds("service");
  await page
    .getByRole("button", { name: "Соединение · L", exact: true })
    .click();
  await drag(
    { x: c.x + c.width, y: c.y + c.height / 2 },
    { x: service.x, y: service.y + service.height / 2 },
  );
  let doc = (await state()).document;
  let connector = doc.objects.at(-1);
  assert.equal(connector.type, "connector");
  assert.equal(connector.start.nodeId, "client");
  assert.equal(connector.end.nodeId, "service");
  note("connector tool binds both ends to cardinal anchors");
  await page
    .getByRole("button", { name: "Редактировать текст", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Текст объекта" })
    .fill("Событие\nЗаказ создан");
  await page.getByRole("textbox", { name: "Текст объекта" }).press("Escape");
  await page.getByLabel("Маршрут").selectOption("straight");
  await page.getByLabel("Наконечники").selectOption("both");
  doc = (await state()).document;
  connector = doc.objects.find((o) => o.id === connector.id);
  assert.equal(connector.text, "Событие\nЗаказ создан");
  assert.equal(connector.route, "straight");
  assert.equal(connector.arrows, "both");
  note("connector label, straight route and two arrowheads");
  let handle = await page.locator('rect[data-end="end"]').boundingBox();
  await drag(
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: 880, y: 560 },
  );
  doc = (await state()).document;
  assert.equal(doc.objects.find((o) => o.id === connector.id).end.type, "free");
  handle = await page.locator('rect[data-end="end"]').boundingBox();
  let sticky = await bounds("note");
  await drag(
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: sticky.x + sticky.width, y: sticky.y + sticky.height / 2 },
  );
  doc = (await state()).document;
  assert.equal(
    doc.objects.find((o) => o.id === connector.id).end.nodeId,
    "note",
  );
  note("endpoint drag detaches and reattaches without modifying label");
  await page.locator('[data-object-id="gateway"]').first().click();
  doc = (await state()).document;
  const original = doc.objects.find((o) => o.id === "gateway");
  handle = await page.locator('rect[data-handle="se"]').boundingBox();
  await page.keyboard.down("Alt");
  await drag(
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    {
      x: handle.x + handle.width / 2 + 38,
      y: handle.y + handle.height / 2 + 25,
    },
  );
  await page.keyboard.up("Alt");
  doc = (await state()).document;
  assert.ok(doc.objects.find((o) => o.id === "gateway").w > original.w);
  assert.deepEqual(doc.objects.find((o) => o.id === "api").end, {
    type: "bound",
    nodeId: "gateway",
    side: "left",
  });
  await page.screenshot({ path: path.join(out, "resize-connector-1366.png") });
  note("resize preserves connector attachment; Alt disables snapping");
  await page
    .getByRole("button", { name: "Заблокировать", exact: true })
    .click();
  const lockedDoc = (await state()).document;
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowRight");
  assert.deepEqual((await state()).document, lockedDoc);
  await page
    .locator('[data-object-id="gateway"]')
    .first()
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Разблокировать", exact: true })
    .click();
  assert.equal(
    (await state()).document.objects.find((o) => o.id === "gateway").locked,
    false,
  );
  note(
    "locked objects remain selectable and can be unlocked from context menu",
  );
  await page.getByRole("button", { name: "Карандаш · P", exact: true }).click();
  const n = (await state()).document.objects.length;
  await drag({ x: 720, y: 615 }, { x: 920, y: 630 });
  await drag({ x: 730, y: 642 }, { x: 890, y: 660 });
  doc = (await state()).document;
  assert.equal(doc.objects.length, n + 2);
  assert.equal(doc.objects.at(-1).type, "stroke");
  assert.equal(
    await page
      .getByRole("button", { name: "Карандаш · P", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  note("each pencil gesture is separate and pencil stays active");
  await page.getByRole("button", { name: "Стикер · N", exact: true }).click();
  await drag({ x: 805, y: 390 }, { x: 980, y: 510 });
  const input = page.getByRole("textbox", { name: "Текст объекта" });
  await input.waitFor();
  await input.fill("Новая заметка\nС кириллицей");
  await input.press("Escape");
  assert.equal(
    (await state()).document.objects.at(-1).text,
    "Новая заметка\nС кириллицей",
  );
  note("sticky starts text entry immediately");
  // Drag/drop uses the real DOM File payload and the main-process image decoder.
  const png = await readFile(path.join(out, "empty-dark-1366.png"));
  await page.locator(".canvas-wrap").evaluate(
    (element, bytes) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(bytes)], "drop.png", { type: "image/png" }),
      );
      element.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: 650,
          clientY: 500,
        }),
      );
    },
    [...png],
  );
  await settle();
  doc = (await state()).document;
  assert.equal(doc.objects.at(-1).type, "image");
  note("PNG drag & drop embeds decoded bytes");
  await page.getByRole("button", { name: "Виды фигур", exact: true }).click();
  await page.getByRole("menuitem", { name: "Эллипс", exact: true }).click();
  await page.keyboard.down("Shift");
  await drag({ x: 900, y: 250 }, { x: 990, y: 310 });
  await page.keyboard.up("Shift");
  doc = (await state()).document;
  const ellipse = doc.objects.at(-1);
  assert.equal(ellipse.shape, "ellipse");
  assert.equal(ellipse.w, ellipse.h);
  note("Shift creates a circle through the ellipse tool");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема интерфейса").selectOption("light");
  await page.getByLabel("Сетка холста").selectOption("lines");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.screenshot({ path: path.join(out, "interaction-light-1366.png") });
  // UI scaling equivalent to 125% browser zoom, without changing system display settings.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25),
  );
  await settle();
  const scaledCapture = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(
    path.join(out, "ui-125-percent.png"),
    Buffer.from(scaledCapture, "base64"),
  );
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    inspector: document.querySelector(".inspector").getBoundingClientRect()
      .right,
    header: document.querySelector(".header-actions").getBoundingClientRect()
      .right,
  }));
  assert.equal(layout.overflow, false);
  assert.ok(layout.inspector <= layout.width + 1);
  assert.ok(layout.header <= layout.width);
  note("1366×768 window at 125% UI scale stays within viewport");
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await page.locator(".canvas").click({ position: { x: 750, y: 600 } });
  await page.keyboard.press("Control+n");
  await settle();
  await page.getByRole("button", { name: "Светлый", exact: true }).click();
  await page.screenshot({ path: path.join(out, "empty-light-1366.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080),
  );
  await settle();
  await page.screenshot({ path: path.join(out, "empty-light-1920.png") });
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить экспорт", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  await page.screenshot({ path: path.join(out, "empty-export-error.png") });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  note("light empty canvas and empty-export error at both window sizes");
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    path.join(out, "interaction-results.json"),
    JSON.stringify({ passed, errors }, null, 2),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(out, "interaction-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
