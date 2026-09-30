import { _electron as electron } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  AXON_TEST_DATA: path.resolve("artifacts/packaged-data-" + Date.now()),
};
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("artifacts", { recursive: true });
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  executablePath: path.resolve(
    process.env.AXON_EXECUTABLE ?? "release/win-unpacked/Axon.exe",
  ),
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  assert.match(await page.title(), /Axon/);
  assert.equal(
    (await page.evaluate(() => window.axon.init())).document.objects.length,
    0,
  );
  const metadata = await app.evaluate(({ app, BrowserWindow }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    preferences:
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(metadata.name, "Axon");
  assert.equal(metadata.version, version);
  assert.equal(metadata.packaged, true);
  assert.equal(metadata.preferences.contextIsolation, true);
  assert.equal(metadata.preferences.sandbox, true);
  assert.equal(metadata.preferences.nodeIntegration, false);
  delete metadata.preferences;
  await page
    .getByRole("button", { name: "Соединение · L", exact: true })
    .click();
  await page.getByRole("button", { name: "Начало линии", exact: true }).click();
  assert.equal(await page.locator(".property-popup select").count(), 0);
  await page
    .getByRole("button", { name: "Контурный круг", exact: true })
    .click();
  await page.getByRole("button", { name: "Конец линии", exact: true }).click();
  await page
    .getByRole("button", { name: "Открытая стрелка", exact: true })
    .click();
  metadata.executable = await app.evaluate(() => process.execPath);
  await page.screenshot({ path: "artifacts/packaged-windows.png" });
  // Exercise the first PDF export from file://, including the deferred local chunk.
  await page.getByRole("button", { name: "Фигура · R", exact: true }).click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(500, 350, { steps: 5 });
  await page.mouse.up();
  const pdfPath = path.join(env.AXON_TEST_DATA, "packaged-export.pdf");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, pdfPath);
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await page.getByRole("button", { name: "PDF Документ", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить экспорт", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await readFile(pdfPath)).subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(errors, [], "packaged renderer errors");
  metadata.pdfExport = true;
  await writeFile(
    "artifacts/packaged-results.json",
    JSON.stringify(metadata, null, 2),
  );
  console.log("PASS packaged Axon.exe startup", metadata);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
