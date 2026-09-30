import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts/workspace");
await mkdir(out, { recursive: true });
const data = path.join(out, "profile-" + Date.now());
const env = { ...process.env, AXON_TEST_DATA: data, AXON_TEST_CHOICE: "0" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: ["tests/recovery-launcher.cjs"],
    cwd: process.cwd(),
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
}
const pause = (n = 300) => page.waitForTimeout(n);
const state = async () => {
  await pause();
  return page.evaluate(() => window.axon.init());
};
const title = async (value) => {
  const s = await state();
  if (!s.document.objects.length) {
    await page.getByRole("button", { name: "Текст · T", exact: true }).click();
    await page.mouse.click(300, 300);
  } else
    await page
      .locator(`[data-object-id="${s.document.objects[0].id}"]`)
      .first()
      .dblclick();
  await page.getByLabel("Текст объекта", { exact: true }).fill(value);
  await page.getByLabel("Текст объекта", { exact: true }).press("Escape");
  await pause();
};
const note = (s) => console.log("PASS " + s);
try {
  await launch();
  await title("A snapshot");
  const aId = (await state()).sessionId;
  await page
    .getByRole("button", { name: "Новая вкладка", exact: true })
    .click();
  await title("B working");
  const bId = (await state()).sessionId;
  await page.getByRole("tab", { name: "● Без названия", exact: true }).click();
  const aPath = path.join(out, "A.axon");
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        globalThis.finishTestSave = resolve;
      });
  });
  await page.keyboard.press("Control+s");
  await pause();
  await page
    .getByRole("tab", { name: "● Без названия 2", exact: true })
    .click();
  await page.getByRole("tab", { name: "● Без названия", exact: true }).click();
  await title("A newer");
  await page
    .getByRole("tab", { name: "● Без названия 2", exact: true })
    .click();
  await app.evaluate(
    (_, filePath) => globalThis.finishTestSave({ canceled: false, filePath }),
    aPath,
  );
  await pause(500);
  let s = await state();
  assert.equal(s.sessionId, bId);
  assert.equal(s.tabs.find((t) => t.sessionId === aId).dirty, true);
  assert.equal(
    JSON.parse(await readFile(aPath, "utf8")).objects[0].text,
    "A snapshot",
  );
  note(
    "asynchronous Save A stays bound to A snapshot while B is active and A receives newer edits",
  );
  await app.evaluate(({ dialog, BrowserWindow }) => {
    let choices = [1, 2];
    dialog.showMessageBox = async () => ({ response: choices.shift() ?? 2 });
    BrowserWindow.getAllWindows()[0].close();
  });
  await pause(500);
  assert.equal(page.isClosed(), false);
  s = await state();
  assert.equal(s.tabs.filter((t) => t.dirty).length, 2);
  note(
    "cancel application close preserves every dirty tab even after an earlier discard choice",
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: "Z:\\missing-drive\\unwritable.axon",
    });
  });
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+w");
  await page.getByRole("alert").waitFor();
  assert.equal((await state()).tabs.length, 2);
  note("failed save does not close a dirty tab");
  await writeFile(
    aPath,
    JSON.stringify({
      ...JSON.parse(await readFile(aPath, "utf8")),
      title: "External change",
    }),
  );
  await page.getByRole("tab", { name: "● A.axon", exact: true }).click();
  await app.evaluate(({ dialog }, target) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, aPath);
  await page.keyboard.press("Control+s");
  await pause();
  assert.equal(
    JSON.parse(await readFile(aPath, "utf8")).title,
    "External change",
  );
  assert.equal((await state()).dirty, true);
  note(
    "external file changes require a safe choice and are never silently overwritten",
  );
  const folder = path.join(out, "folder-" + Date.now());
  await mkdir(folder);
  const template = (await state()).document;
  await writeFile(
    path.join(folder, "one.axon"),
    JSON.stringify({ ...template, title: "Folder one" }),
  );
  await writeFile(
    path.join(folder, "two.axon"),
    JSON.stringify({ ...template, title: "Folder two" }),
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, folder);
  await page
    .getByRole("button", { name: "Рабочая папка", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать папку…", exact: true })
    .click();
  assert.equal((await state()).tabs.length, 2);
  await page.getByRole("button", { name: "one.axon", exact: true }).click();
  assert.equal((await state()).tabs.length, 3);
  await page
    .getByRole("button", { name: "Рабочая папка", exact: true })
    .click();
  await page.getByRole("button", { name: "one.axon", exact: true }).click();
  assert.equal((await state()).tabs.length, 3);
  await writeFile(path.join(folder, "three.axon"), JSON.stringify(template));
  await page
    .getByRole("button", { name: "Рабочая папка", exact: true })
    .click();
  await page.getByRole("button", { name: "three.axon", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Закрыть список папки", exact: true })
    .click();
  note(
    "folder choice leaves tabs intact, opens only clicked files, deduplicates and refreshes the listing",
  );
  await page
    .getByRole("tab", { name: "● Без названия 2", exact: true })
    .click();
  await pause(1300);
  const recovery = JSON.parse(
    await readFile(path.join(data, "recovery.json"), "utf8"),
  );
  assert.equal(recovery.tabs.length, 3);
  assert.equal(
    recovery.tabs.find((t) => t.sessionId === aId).document.objects[0].text,
    "A newer",
  );
  await rm(aPath);
  await app.evaluate(({ app }) => app.exit());
  await launch();
  s = await state();
  assert.equal(s.tabs.length, 3);
  assert.equal(s.sessionId, bId);
  assert.equal(s.tabs.find((t) => t.sessionId === aId).unavailable, true);
  assert.equal(
    s.tabs.find((t) => t.sessionId === aId).document.objects[0].text,
    "A newer",
  );
  assert.equal(s.workspaceFolder, folder);
  note(
    "recovery restores all working copies, active tab and folder; missing source file retains its document",
  );
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  const recoveryPath = path.resolve(data, "recovery.json");
  assert.ok(recoveryPath.startsWith(out + path.sep));
  const previousRecovery = await readFile(recoveryPath);
  await rm(recoveryPath);
  await mkdir(recoveryPath);
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+w");
  await page.getByRole("alert").waitFor();
  assert.ok((await state()).tabs.some((t) => t.sessionId === bId));
  await rmdir(recoveryPath);
  await writeFile(recoveryPath, previousRecovery);
  note("failed recovery commit leaves the closing tab available");
  await page.locator(".canvas").focus();
  await page.keyboard.press("Control+w");
  await pause(1200);
  s = await state();
  assert.ok(!s.tabs.some((t) => t.sessionId === bId));
  assert.ok(
    !JSON.parse(
      await readFile(path.join(data, "recovery.json"), "utf8"),
    ).tabs.some((t) => t.sessionId === bId),
  );
  assert.equal(
    JSON.parse(await readFile(path.join(folder, "one.axon"), "utf8")).title,
    "Folder one",
  );
  note(
    "explicit discard removes only the closed tab from recovery and never deletes files",
  );
  assert.deepEqual(errors, []);
} finally {
  await app?.evaluate(({ app }) => app.exit()).catch(() => {});
}
