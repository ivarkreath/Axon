import { _electron as electron } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  AXON_TEST_DATA: path.resolve("artifacts/packaged-data-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  executablePath: path.resolve("release/win-unpacked/Axon.exe"),
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
  await page.screenshot({ path: "artifacts/packaged-windows.png" });
  await writeFile(
    "artifacts/packaged-results.json",
    JSON.stringify(metadata, null, 2),
  );
  console.log("PASS packaged Axon.exe startup", metadata);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
