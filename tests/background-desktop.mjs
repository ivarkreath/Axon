import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
const env = { ...process.env, AXON_TEST_DATA: path.resolve("artifacts/background-" + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.AXON_DEV_URL;
const app = await electron.launch({ args: ["."], env });
const page = await app.firstWindow();
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 850));
  await page.locator(".canvas").click({ button: "right", position: { x: 1320, y: 680 } });
  await page.getByRole("menuitem", { name: "Тема", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Другой цвет…", exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: "Другой цвет…", exact: true }).click({ timeout: 3000 });
  await page.getByRole("textbox", { name: "Фон документа HEX" }).fill("#294154");
  await page.getByRole("button", { name: "Применить цвет", exact: true }).click();
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  assert.equal((await page.evaluate(() => window.axon.init())).document.background, "#294154");
  console.log("PASS background submenu pointer transition and custom HEX");
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
