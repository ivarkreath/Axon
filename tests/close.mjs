import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("artifacts"),
  data = path.join(out, "close-data-" + Date.now());
const fixture = JSON.parse(
  await readFile(path.join(out, "acceptance.axon"), "utf8"),
);
const env = { ...process.env, AXON_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  args: [".", path.join(out, "acceptance.axon")],
  cwd: process.cwd(),
  env,
});
const page = await app.firstWindow();
const passed = [];
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await page.locator('[data-object-id="note"]').first().click();
  await page
    .getByRole("button", { name: "Редактировать текст", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Текст объекта" })
    .fill("Последний ввод перед закрытием");
  await app.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({
      response: 2,
      checkboxChecked: false,
    });
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.waitForTimeout(400);
  assert.equal(page.isClosed(), false);
  const state = await page.evaluate(() => window.axon.init());
  assert.equal(
    state.document.objects.find((o) => o.id === "note").text,
    "Последний ввод перед закрытием",
  );
  assert.equal(state.dirty, true);
  passed.push("close flushes active text before debounce; Cancel retains it");
  const previous = await readFile(path.join(out, "acceptance.axon"), "utf8");
  await app.evaluate(
    ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    },
    path.join(out, "acceptance.axon", "invalid.axon"),
  );
  await page.keyboard.press("Control+Shift+s");
  await page.waitForTimeout(500);
  assert.equal(
    await readFile(path.join(out, "acceptance.axon"), "utf8"),
    previous,
  );
  assert.equal((await page.evaluate(() => window.axon.init())).dirty, true);
  await page.getByRole("alert").waitFor();
  passed.push("failed Save As preserves previous file and dirty document");
  await app.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.waitForEvent("close");
  const recovery = JSON.parse(
    await readFile(path.join(data, "recovery.json"), "utf8"),
  );
  assert.deepEqual(recovery.document, fixture);
  passed.push("discard on close restores only last manually saved content");
  await writeFile(
    path.join(out, "close-results.json"),
    JSON.stringify(passed, null, 2),
  );
  console.log(passed.map((s) => "PASS " + s).join("\n"));
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
