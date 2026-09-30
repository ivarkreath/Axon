import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const env = {
  ...process.env,
  AXON_TEST_DATA: path.resolve("artifacts", "gestures-" + Date.now()),
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
async function drag(a, b, cancel = false) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  await pause();
}
async function bounds(id) {
  return page.locator(`[data-object-id="${id}"]`).first().boundingBox();
}
async function marker(id, side = "right") {
  const b = await bounds(id);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await pause();
  const m = await page
    .locator(`[data-object-id="${id}"][data-connect="${side}"]`)
    .boundingBox();
  return { x: m.x + m.width / 2, y: m.y + m.height / 2 };
}
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  await page.getByRole("button", { name: "Фигура · R", exact: true }).click();
  await drag({ x: 300, y: 360 }, { x: 480, y: 460 });
  let s = await state();
  const source = s.document.objects[0].id;
  let m = await marker(source);
  await page.mouse.click(m.x, m.y);
  await page.getByLabel("Текст объекта").press("Escape");
  s = await state();
  const target = s.document.objects.find(
    (o) => o.type === "shape" && o.id !== source,
  ).id;
  m = await marker(source);
  let b = await bounds(target);
  await drag(m, { x: b.x, y: b.y + b.height / 2 });
  s = await state();
  assert.equal(s.document.objects.filter((o) => o.type === "shape").length, 2);
  assert.equal(s.document.objects.at(-1).end.nodeId, target);
  const beforeCancel = s.document;
  m = await marker(source);
  await drag(m, { x: 900, y: 600 }, true);
  assert.deepEqual((await state()).document, beforeCancel);
  m = await marker(source);
  await drag(m, { x: 920, y: 620 });
  assert.equal((await state()).document.objects.at(-1).end.type, "free");
  note(
    "marker drag creates only a bound/free connection; Escape leaves no objects or partial history",
  );
  await page.locator(`[data-object-id="${source}"]`).first().dblclick();
  const text = page.getByLabel("Текст объекта");
  await text.fill(
    "Длинный русский текст для проверки переноса, настроек и сохранения позиции ввода при выборе цвета.",
  );
  await text.evaluate((t) => t.setSelectionRange(3, 7));
  await page.getByRole("button", { name: "Цвет текста", exact: true }).click();
  await page.getByRole("button", { name: "Цвет текста #F1D58A", exact: true }).click();
  assert.equal(await text.count(), 1);
  assert.deepEqual(
    await text.evaluate((t) => [t.selectionStart, t.selectionEnd]),
    [3, 7],
  );
  await page.getByLabel("Размер текста", { exact: true }).fill("24");
  await text.focus();
  await text.press("Escape");
  const panel = await page
    .getByRole("toolbar", { name: "Свойства выделения" })
    .boundingBox();
  assert.ok(
    panel.x >= 0 &&
      panel.y >= 0 &&
      panel.x + panel.width <= 1366 &&
      panel.y + panel.height <= 768,
  );
  await page.keyboard.down("Shift");
  await page.locator(`[data-object-id="${target}"]`).first().click();
  await page.keyboard.up("Shift");
  assert.equal(
    await page.getByLabel("Размер текста", { exact: true }).inputValue(),
    "",
  );
  const beforeFormat = (await state()).document;
  await page.getByLabel("Размер текста", { exact: true }).fill("20");
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).document, beforeFormat);
  note(
    "picker retains text session/caret, long Cyrillic text fits, mixed font value and bulk Undo work",
  );
  await page
    .locator(`[data-object-id="${target}"]`)
    .first()
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Заблокировать", exact: true })
    .click();
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+a");
  assert.equal(await page.locator("[data-scale]").count(), 0);
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page
    .getByRole("button", { name: "Исключить заблокированные", exact: true })
    .click();
  assert.equal(await page.locator("[data-scale]").count(), 4);
  const beforeResize = (await state()).document;
  const handle = await page
    .locator('[data-scale][data-handle="se"]')
    .boundingBox();
  await drag(
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: handle.x - 70, y: handle.y - 50 },
    true,
  );
  assert.deepEqual((await state()).document, beforeResize);
  note(
    "locked mixed selection disables scale; exclusion is explicit; Escape restores the entire resize",
  );
  await page
    .getByRole("button", { name: "Новая вкладка", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать mind map", exact: true })
    .click();
  await page.mouse.click(500, 350);
  await page.getByLabel("Текст объекта").fill("Root");
  await page.getByLabel("Текст объекта").press("Escape");
  await page.locator(".canvas").focus();
  await page.keyboard.press("Tab");
  await page.getByLabel("Текст объекта").fill("Child");
  await page.getByLabel("Текст объекта").press("Escape");
  s = await state();
  const root = s.document.objects.find((o) => o.mind?.parentId === null).id;
  await page.locator(`[data-object-id="${root}"]`).first().click();
  const tree = (await state()).document;
  await page.keyboard.press("Delete");
  assert.equal((await state()).document.objects.length, 0);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await state()).document, tree);
  await page.locator(`[data-object-id="${root}"]`).first().click();
  await page.keyboard.press("Control+d");
  s = await state();
  assert.equal(
    s.document.objects.filter((o) => o.mind?.parentId === null).length,
    2,
  );
  assert.equal(
    new Set(s.document.objects.map((o) => o.id)).size,
    s.document.objects.length,
  );
  note(
    "nonempty subtree deletes and undoes atomically; duplicate creates an independent tree",
  );
  assert.deepEqual(errors, []);
} catch (e) {
  await page.screenshot({
    path: path.resolve("artifacts/gesture-failure.png"),
  });
  throw e;
} finally {
  await app.evaluate(({ app }) => app.exit());
}
