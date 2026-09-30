import { createServer } from "vite";
import { _electron as electron } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
const server = await createServer();
await server.listen();
const env = {
  ...process.env,
  AXON_DEV_URL: "http://127.0.0.1:5173",
  AXON_TEST_DATA: path.resolve("artifacts/dev-data-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(message.text());
  });
  try {
    await page
      .getByRole("button", { name: "Файл", exact: true })
      .waitFor({ timeout: 15000 });
  } catch (error) {
    console.log(await page.locator("body").innerText());
    console.log(errors);
    throw error;
  }
  assert.deepEqual(errors, [], "development renderer errors");
  console.log("PASS development runtime", errors);
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await server.close();
}
