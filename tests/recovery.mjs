import { _electron as electron } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("artifacts");
const doc = JSON.parse(
  await readFile(path.join(root, "roundtrip.axon"), "utf8"),
);
const modified = { ...doc, title: "Восстановленная схема" };
const original = JSON.stringify(doc);
const preferences = {
  theme: "dark",
  reducedMotion: false,
  grid: "dots",
  snapObjects: true,
  snapGrid: false,
  restoreSession: true,
  styles: {},
};
const results = [];
for (const [name, restore, choice] of [
  ["restore", true, 0],
  ["discard", true, 1],
  ["disabled", false, 0],
]) {
  const data = path.join(root, "recovery-" + name + "-" + Date.now());
  await mkdir(data, { recursive: true });
  await writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({
      preferences: { ...preferences, restoreSession: restore },
      recents: [],
    }),
  );
  await writeFile(
    path.join(data, "recovery.json"),
    JSON.stringify({
      document: modified,
      saved: original,
      path: path.join(root, "roundtrip.axon"),
      at: new Date().toISOString(),
    }),
  );
  const env = {
    ...process.env,
    AXON_TEST_DATA: data,
    AXON_TEST_CHOICE: String(choice),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AXON_DEV_URL;
  const app = await electron.launch({
    args: ["tests/recovery-launcher.cjs"],
    cwd: process.cwd(),
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
    const session = await page.evaluate(() => window.axon.init());
    if (name === "restore") {
      assert.equal(session.document.title, modified.title);
      assert.equal(session.dirty, true);
      assert.deepEqual(session.document.assets, doc.assets);
      await page.screenshot({ path: path.join(root, "recovery-restored.png") });
    } else {
      assert.equal(session.document.objects.length, 0);
      assert.equal(session.dirty, false);
    }
    results.push(name);
    console.log("PASS recovery " + name);
    if (name === "restore") {
      // New retains the working copy; explicit close/discard removes only that tab.
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await page.locator(".canvas").click({ position: { x: 800, y: 550 } });
      await page.keyboard.press("Control+n");
      await page.waitForTimeout(1200);
      const saved = JSON.parse(
        await readFile(path.join(data, "recovery.json"), "utf8"),
      );
      assert.deepEqual(
        saved.tabs.find((t) => t.sessionId === session.sessionId).document,
        modified,
      );
      await page.evaluate(({ id, doc }) => window.axon.closeTab(id, doc), {
        id: session.sessionId,
        doc: modified,
      });
      const afterClose = JSON.parse(
        await readFile(path.join(data, "recovery.json"), "utf8"),
      );
      assert.ok(
        !afterClose.tabs.some((t) => t.sessionId === session.sessionId),
      );
      results.push("explicit-discard-clears-recovery");
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
await writeFile(
  path.join(root, "recovery-results.json"),
  JSON.stringify(results, null, 2),
);
