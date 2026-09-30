import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  AXON_TEST_DATA: path.resolve("artifacts/packaged-data-" + Date.now()),
};
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
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  assert.match(await page.title(), /Axon/);
  assert.equal(
    (await page.evaluate(() => window.axon.init())).document.objects.length,
    0,
  );
  const metadata = await app.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  assert.equal(metadata.name, "Axon");
  assert.equal(metadata.packaged, true);
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
  await writeFile(
    "artifacts/packaged-results.json",
    JSON.stringify(metadata, null, 2),
  );
  console.log("PASS packaged Axon.exe startup", metadata);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
