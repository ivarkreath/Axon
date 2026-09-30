import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts/corrections");
await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile("artifacts/acceptance.axon", "utf8"));
const shape = fixture.objects.find((o) => o.type === "shape");
const objects = [
  [-255, -140],
  [1040, -140],
  [-255, 355],
  [1040, 355],
  [350, -140],
  [350, 355],
].map(([x, y], i) => ({
  ...shape,
  id: "edge-" + i,
  x,
  y,
  w: 170,
  h: 90,
  text: "Объект " + i,
  groupId: undefined,
  mind: undefined,
}));
const doc = { ...fixture, id: "panel-test", version: 3, objects, assets: {} };
const file = path.join(out, "Panel edges.axon");
await writeFile(file, JSON.stringify(doc));
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(out, "panels-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  args: [".", file],
  cwd: process.cwd(),
  env,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pause = () => page.waitForTimeout(200);
const button = (name) => page.getByRole("button", { name, exact: true });
const state = async () => {
  await pause();
  return page.evaluate(() => window.axon.init());
};
const focus = () => page.locator(".canvas").focus();
async function drag(a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await pause();
}
const panel = () =>
  page.getByRole("toolbar", { name: "Свойства выделения", exact: true });
async function inside(locator) {
  const b = await locator.boundingBox(),
    v = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
  assert.ok(
    b &&
      b.x >= 11 &&
      b.y >= 11 &&
      b.x + b.width <= v.w - 11 &&
      b.y + b.height <= v.h - 11,
    JSON.stringify({ b, v }),
  );
}
try {
  await button("Файл").waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  await pause();
  for (let i = 0; i < 6; i++) {
    const o = page.locator(`g[data-object-id="edge-${i}"]`).first(),
      b = await o.boundingBox();
    await page.mouse.click(Math.max(25, b.x + b.width / 2), b.y + b.height / 2);
    await pause();
    await inside(panel());
    assert.equal(Math.round((await panel().boundingBox()).height), 44);
    await page
      .getByRole("combobox", { name: "Шрифт", exact: true })
      .selectOption("mono");
    await button("Заливка").click();
    await inside(page.locator(".property-popup"));
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: path.join(out, "panels-edges-1366.png") });
  await page.mouse.move(950, 420);
  await page.mouse.wheel(2000, 2000);
  await pause();
  assert.equal(await panel().count(), 0);
  await page.mouse.wheel(-2000, -2000);
  await pause();
  assert.equal(await panel().count(), 1);
  const before = (await state()).document;
  await button("Карандаш · P").click();
  await page
    .getByRole("combobox", { name: "Толщина", exact: true })
    .selectOption("12");
  assert.deepEqual((await state()).document, before);
  await drag({ x: 450, y: 350 }, { x: 560, y: 380 });
  await drag({ x: 600, y: 350 }, { x: 710, y: 380 });
  assert.equal(await page.locator(".selection").count(), 0);
  await button("Соединение · L").click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Толщина", exact: true })
      .inputValue(),
    "2",
  );
  await drag({ x: 380, y: 420 }, { x: 750, y: 420 });
  const connection = (await state()).document.objects.at(-1);
  assert.equal(connection.style.strokeWidth, 2);
  await page
    .getByRole("combobox", { name: "Толщина", exact: true })
    .selectOption("6");
  await button("Соединение · L").click();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Толщина", exact: true })
      .inputValue(),
    "2",
  );
  await page
    .getByRole("combobox", { name: "Толщина", exact: true })
    .selectOption("12");
  await button("Создать mind map").click();
  await page.mouse.click(450, 460);
  await page
    .getByLabel("Текст объекта", { exact: true })
    .fill("Независимый стиль");
  await page.getByLabel("Текст объекта", { exact: true }).press("Escape");
  await focus();
  await page.keyboard.press("Tab");
  await page.getByLabel("Текст объекта", { exact: true }).fill("Ветвь 1,5");
  await page.getByLabel("Текст объекта", { exact: true }).press("Escape");
  assert.equal(
    (await state()).document.objects.find((o) => o.mindBranch).style
      .strokeWidth,
    1.5,
  );
  await button("Показать всё · Shift + 1").click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(984, 650),
  );
  for (const factor of [1, 1.25]) {
    await app.evaluate(
      ({ BrowserWindow }, f) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f),
      factor,
    );
    await pause();
    await button("Фигура · R").click();
    const p = page.getByRole("toolbar", {
      name: "Стиль создания",
      exact: true,
    });
    await inside(p);
    assert.equal(Math.round((await p.boundingBox()).height), 44);
    const boxes = await Promise.all(
      [
        p,
        page.locator(".toolbar"),
        page.locator(".navigation"),
        page.locator(".bottom-left"),
      ].map((l) => l.boundingBox()),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `overlapping panels: ${JSON.stringify({ a, b })}`,
        );
      }
    if (factor === 1.25) {
      await button("Масштаб и навигация").click();
      await page
        .getByRole("menuitem", { name: "Масштаб 100%", exact: true })
        .click();
      const current = await state();
      assert.equal(
        current.tabs.find((t) => t.sessionId === current.sessionId).view.camera
          .zoom,
        1,
      );
    }
    const capture = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
        .toPNG()
        .toString("base64"),
    );
    await writeFile(
      path.join(out, `panels-ui-${factor}.png`),
      Buffer.from(capture, "base64"),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS six viewport edges/partial/offscreen, popovers, font, pencil without frames, isolated defaults and explicit object styling, mind branches independent, UI 100/125%",
  );
} catch (e) {
  await page.screenshot({ path: path.join(out, "panels-failure.png") });
  throw e;
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
