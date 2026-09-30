import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const exe = path.resolve("release/win-unpacked/Axon.exe");
const env = { ...process.env, AXON_TEST_DATA: path.resolve("artifacts/publication-busy-" + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.AXON_DEV_URL;
const hash = async () => createHash("sha256").update(await readFile("release/win-unpacked/resources/app.asar")).digest("hex");
const before = await hash();
const app = await electron.launch({ executablePath: exe, args: [], env });
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  const result = spawnSync(process.execPath, ["scripts/publish-windows.mjs"], { encoding: "utf8", env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Сохраните работу и закройте Axon/);
  assert.equal(await hash(), before);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(await page.getByRole("button", { name: "Файл", exact: true }).isVisible(), true);
  console.log("PASS publication refuses a running canonical Axon, does not terminate it or change its resources");
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
