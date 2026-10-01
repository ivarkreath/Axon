import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const out = path.resolve("artifacts/review-desktop-" + Date.now());
await mkdir(out, { recursive: true });
const doc = JSON.parse(await readFile("artifacts/acceptance.axon", "utf8"));
const source = doc.objects.find(o => o.type === "shape" && !o.mind);
assert.ok(source);
doc.id = randomUUID();
doc.assets = {};
doc.objects = Array.from({ length: 4 }, (_, i) => ({
  ...source, id: `node-${i}`, x: (i % 2) * 350, y: Math.floor(i / 2) * 250,
  w: 160, h: 90, text: `Узел ${i}`, groupId: undefined, locked: false,
}));
for (const [a, b] of [[0, 1], [2, 3]]) doc.objects.unshift({
  ...source, id: `link-${a}`, type: "connector", shape: undefined,
  x: 0, y: 0, w: 1, h: 1, text: "Связь", route: "curved", arrows: "end",
  start: { type: "bound", nodeId: `node-${a}`, side: "right" },
  end: { type: "bound", nodeId: `node-${b}`, side: "left" },
});
const target = path.join(out, "review.axon"), profile = path.join(out, "profile");
await writeFile(target, JSON.stringify(doc));
const env = { ...process.env, AXON_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({ args: [".", target], cwd: process.cwd(), env });
const page = await app.firstWindow(), errors = [], passed = [];
page.on("pageerror", e => errors.push(e.message));
const pause = (ms = 350) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.axon.init());
const node = id => page.locator(`[data-object-id="${id}"]`).first();
const note = text => { passed.push(text); console.log("PASS " + text); };
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await page.getByRole("button", { name: "Показать всё · Shift + 1", exact: true }).click();
  await pause();
  const box = await node("node-0").boundingBox();
  const original = (await state()).document.objects.find(o => o.id === "node-0");
  const unrelatedPath = await node("link-2").locator("path").first().getAttribute("d");
  const boundPath = await node("link-0").locator("path").first().getAttribute("d");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 35, { steps: 5 });
  await page.keyboard.up("Alt");
  // Save while pointer capture is still active must commit the visible preview.
  await page.keyboard.press("Control+s");
  await pause(700);
  await page.mouse.up();
  const saved = JSON.parse(await readFile(target, "utf8"));
  const moved = saved.objects.find(o => o.id === "node-0");
  assert.notEqual(moved.x, original.x);
  assert.equal((await state()).dirty, false);
  assert.equal(await node("link-2").locator("path").first().getAttribute("d"), unrelatedPath);
  assert.notEqual(await node("link-0").locator("path").first().getAttribute("d"), boundPath);
  note("Save commits active drag; only the attached connector changes");

  await page.keyboard.press("Control+z");
  await pause();
  assert.equal((await state()).document.objects.find(o => o.id === "node-0").x, original.x);
  assert.equal((await state()).dirty, true);
  await page.keyboard.press("Control+Shift+z");
  await pause();
  assert.equal((await state()).document.objects.find(o => o.id === "node-0").x, moved.x);
  assert.equal((await state()).dirty, false);
  note("one drag history entry; Undo/Redo tracks the written snapshot");

  // Let content-triggered recovery finish, then camera/selection must not cause
  // another document serialization/write after their own debounce expires.
  await pause(1300);
  const recovery = path.join(profile, "recovery.json");
  const before = (await stat(recovery)).mtimeMs;
  await node("node-2").click();
  await page.mouse.move(750, 600);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(790, 630, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -30);
  await page.keyboard.up("Control");
  await pause(1400);
  assert.equal((await stat(recovery)).mtimeMs, before);
  assert.equal((await state()).dirty, false);
  note("selection/pan/zoom update view without serializing recovery or dirtying the document");

  await node("node-2").dblclick();
  await page.getByLabel("Текст объекта", { exact: true }).fill("Русский текст\nперед сменой вкладки");
  await page.getByRole("button", { name: "Новая вкладка", exact: true }).click();
  await pause();
  const sessions = await state();
  const edited = sessions.tabs.find(t => t.document.id === doc.id);
  assert.equal(edited.document.objects.find(o => o.id === "node-2").text, "Русский текст\nперед сменой вкладки");
  assert.equal(edited.dirty, true);
  assert.equal(sessions.dirty, false);
  note("tab switch commits active text and keeps independent dirty states");

  await page.getByRole("tab").filter({ hasText: "review" }).click();
  await node("node-2").dblclick();
  await page.getByLabel("Текст объекта", { exact: true }).fill("Последний ввод перед отменой Save As");
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await page.keyboard.press("Control+Shift+s");
  await pause(1400);
  const recovered = JSON.parse(await readFile(recovery, "utf8"));
  assert.equal(recovered.tabs.find(t => t.document.id === doc.id).document.objects.find(o => o.id === "node-2").text,
    "Последний ввод перед отменой Save As");
  assert.equal((await state()).dirty, true);
  note("cancelled Save As still backs up the accepted latest input");

  const recents = (await state()).recents;
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, path.join(target, "invalid.axon"));
  await page.keyboard.press("Control+Shift+s");
  await page.getByRole("alert").waitFor();
  assert.deepEqual((await state()).recents, recents);
  assert.equal((await state()).dirty, true);
  note("failed write does not change dirty, path or recents");

  // A settings failure is independent of the already successful document write.
  const settings = path.join(profile, "settings.json");
  await rm(settings);
  await mkdir(settings);
  await app.evaluate(({ dialog }) => {
    globalThis.reviewWarnings = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.reviewWarnings.push(options.message);
      return { response: 0 };
    };
  });
  await page.keyboard.press("Control+s");
  await pause(700);
  assert.equal((await state()).dirty, false);
  assert.equal(JSON.parse(await readFile(target, "utf8")).objects.find(o => o.id === "node-2").text,
    "Последний ввод перед отменой Save As");
  assert.match((await app.evaluate(() => globalThis.reviewWarnings))[0], /Документ сохранён/);
  note("successful document write stays clean when recent-files settings fail");
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, "results.json"), JSON.stringify({ passed, errors }, null, 2));
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
