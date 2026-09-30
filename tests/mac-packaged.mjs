import { _electron as electron } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { listPackage } from "@electron/asar";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

assert.equal(process.platform, "darwin", "Run this test on macOS.");
const arch = process.env.AXON_MAC_ARCH || process.arch;
assert.ok(["arm64", "x64"].includes(arch));
assert.equal(process.arch, arch, "Use a native runner for each architecture.");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const output = path.resolve("artifacts");
await mkdir(output, { recursive: true });
const base = path.resolve(`release/Axon-${version}-mac-${arch}`);
const extracted = path.join(output, `mac-extracted-${arch}-${Date.now()}`);
execFileSync("hdiutil", ["verify", `${base}.dmg`], { stdio: "inherit" });
execFileSync("ditto", ["-x", "-k", `${base}.zip`, extracted]);
const bundle = path.join(extracted, "Axon.app");
async function auditBundle(appPath) {
  const asar = path.join(appPath, "Contents", "Resources", "app.asar");
  const entries = [
    ...(await readdir(appPath, { recursive: true })),
    ...listPackage(asar),
  ];
  const forbidden = entries.filter((name) =>
    /(?:^|[/\\])(?:AGENTS(?:\.override)?\.md|\.agent|\.agents|\.codex|\.gitnexus[^/\\]*|\.env[^/\\]*|tests|artifacts|recovery\.json|settings\.json)(?:$|[/\\])|\.(?:axon|pem|key|p12|pfx)$/i.test(
      name,
    ),
  );
  assert.deepEqual(forbidden, [], "Private/development files in macOS package");
  return createHash("sha256")
    .update(await readFile(asar))
    .digest("hex");
}
const asarSha256 = await auditBundle(bundle);
const mounted = path.join(output, `mac-mounted-${arch}-${Date.now()}`);
await mkdir(mounted);
execFileSync("hdiutil", [
  "attach",
  `${base}.dmg`,
  "-readonly",
  "-nobrowse",
  "-mountpoint",
  mounted,
]);
try {
  const dmgBundle = path.join(mounted, "Axon.app");
  assert.equal(
    await auditBundle(dmgBundle),
    asarSha256,
    "DMG and ZIP must contain the same application",
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", dmgBundle]);
} finally {
  execFileSync("hdiutil", ["detach", mounted]);
}
execFileSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", bundle],
  {
    stdio: "inherit",
  },
);
const signature = spawnSync("codesign", ["-d", "--verbose=2", bundle], {
  encoding: "utf8",
});
assert.equal(signature.status, 0);
assert.match(signature.stderr, /Signature=adhoc/);
const env = {
  ...process.env,
  AXON_TEST_DATA: path.join(output, `mac-data-${arch}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  executablePath: path.join(bundle, "Contents", "MacOS", "Axon"),
  args: [],
  env,
  timeout: 60000,
});
let page;
const errors = [];
const checks = [
  "DMG integrity and mounted bundle signature",
  "ZIP extraction",
  "DMG and ZIP privacy audit and matching app.asar",
  "ad-hoc bundle signature",
];
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "Файл", exact: true })
    .waitFor({ timeout: 60000 });
  const metadata = await app.evaluate(({ app, BrowserWindow }) => {
    const preferences =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768);
    return {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
      nodeIntegration: preferences.nodeIntegration,
    };
  });
  assert.equal(metadata.name, "Axon");
  assert.equal(metadata.version, version);
  assert.equal(metadata.packaged, true);
  assert.equal(metadata.contextIsolation, true);
  assert.equal(metadata.sandbox, true);
  assert.equal(metadata.nodeIntegration, false);
  checks.push("packaged startup and renderer isolation");
  await page.getByRole("button", { name: "Фигура · R", exact: true }).click();
  const box = await page.locator(".canvas").boundingBox();
  await page.mouse.move(box.x + 160, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 300, { steps: 10 });
  await page.mouse.up();
  await page.mouse.dblclick(box.x + 260, box.y + 235);
  const text = page.getByRole("textbox", { name: "Текст объекта" });
  await text.fill("Axon на macOS\nКириллица и латиница");
  await text.press("Meta+a");
  assert.equal(await text.inputValue(), "Axon на macOS\nКириллица и латиница");
  const file = path.join(output, `mac-${arch}.axon`);
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await text.press("Meta+s");
  await text.waitFor({ state: "hidden" });
  await page.getByText("Файл сохранён", { exact: true }).first().waitFor();
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.objects.length, 1);
  assert.equal(saved.objects[0].text, "Axon на macOS\nКириллица и латиница");
  checks.push("shape, Cyrillic editing, Cmd+A and Cmd+S, disk save");
  await page.locator(".canvas").click({ position: { x: 650, y: 400 } });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема интерфейса").selectOption("light");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(output, `mac-${arch}-light.png`) });
  checks.push("light theme");
  assert.deepEqual(errors, []);
  const report = {
    ...metadata,
    asarSha256,
    arch,
    osRelease: os.release(),
    checks,
    errors,
    signing: "ad-hoc; no Developer ID or notarization",
    commit: process.env.GITHUB_SHA || null,
  };
  await writeFile(
    path.join(output, `mac-${arch}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, `mac-${arch}-failure.png`) })
      .catch(() => {});
  console.log("Renderer errors:", errors);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
