import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listPackage } from "@electron/asar";
import {
  applicationFiles,
  checkedOutput,
} from "../scripts/windows-publish.mjs";

// Installation changes registry/shortcuts: run only on a disposable hosted runner.
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.ok(process.env.RUNNER_TEMP);
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const installer = path.resolve(`release/Axon-${version}-Setup-x64.exe`);
const installed = await checkedOutput(
  process.env.RUNNER_TEMP,
  path.join(process.env.RUNNER_TEMP, `axon-install-${Date.now()}`, "Axon"),
);
await access(installer);
await mkdir(path.dirname(installed), { recursive: true });
execFileSync(installer, ["/S", "/currentuser", `/D=${installed}`], {
  windowsHide: true,
  stdio: "inherit",
  timeout: 180000,
});
const executable = path.join(installed, "Axon.exe");
const asar = path.join(installed, "resources", "app.asar");
await access(executable);
const entries = [...(await applicationFiles(installed)), ...listPackage(asar)];
const forbidden = entries.filter((name) =>
  /(?:^|[/\\])(?:AGENTS(?:\.override)?\.md|\.agent|\.agents|\.codex|\.gitnexus[^/\\]*|\.env[^/\\]*|tests|artifacts|recovery\.json|settings\.json)(?:$|[/\\])|\.(?:axon|pem|key|p12|pfx)$/i.test(
    name,
  ),
);
assert.deepEqual(
  forbidden,
  [],
  "Private/development files in installed application",
);
const sha256 = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const asarSha256 = await sha256(asar);
assert.equal(
  asarSha256,
  await sha256("release/win-unpacked/resources/app.asar"),
);
execFileSync(process.execPath, ["tests/packaged.mjs"], {
  env: { ...process.env, AXON_EXECUTABLE: executable },
  windowsHide: true,
  stdio: "inherit",
  timeout: 180000,
});
const report = {
  version,
  commit: process.env.GITHUB_SHA,
  installer: path.basename(installer),
  installerSha256: await sha256(installer),
  asarSha256,
  installed: true,
  checks: [
    "silent per-user installation",
    "installed package privacy audit",
    "installed app.asar matches verified application",
    "installed startup and PDF export",
  ],
  signing: "unsigned",
};
await writeFile(
  "artifacts/windows-installer.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
