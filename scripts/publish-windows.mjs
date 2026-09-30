import { spawnSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { applicationFiles, checkedOutput, replaceApplication } from "./windows-publish.mjs";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const release = path.join(project, "release"),
  service = path.join(release, ".windows-build");
const output = path.join(service, "stage"),
  staged = path.join(output, "win-unpacked");
const canonical = path.join(release, "win-unpacked"),
  previous = path.join(service, "previous");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
delete env.AXON_TEST_DATA;
const run = (args, extra = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: project,
    env: { ...env, ...extra },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw (
      result.error ??
      new Error(`Command failed (${result.status}): node ${args.join(" ")}`)
    );
};
function ensureClosed() {
  const check = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; @(Get-Process Axon -ErrorAction SilentlyContinue | Select-Object Id,Path) | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (check.error || check.status !== 0)
    throw new Error(
      `Cannot check running Axon processes: ${check.error?.message ?? check.stderr}`,
    );
  const processes = JSON.parse(check.stdout.trim() || "[]");
  const running = (Array.isArray(processes) ? processes : [processes]).filter(
    (p) =>
      !p.Path ||
      p.Path.toLowerCase().startsWith(canonical.toLowerCase() + path.sep),
  );
  if (running.length)
    throw new Error(
      `Сохраните работу и закройте Axon (${running.map((p) => p.Id).join(", ")}), затем повторите npm run dist:win. Каноническая копия не обновлена.`,
    );
}
async function audit(dir) {
  for (const file of [
    "Axon.exe",
    "resources/app.asar",
    "icudtl.dat",
    "chrome_100_percent.pak",
  ])
    await access(path.join(dir, file));
  const entries = [...await applicationFiles(dir), ...listPackage(path.join(dir, "resources/app.asar"))];
  const forbidden = entries.filter((name) =>
    /(?:^|[/\\])(?:AGENTS\.md|\.agent|\.agents|\.codex|\.gitnexus[^/\\]*|\.env[^/\\]*|tests|artifacts|recovery\.json|settings\.json)(?:$|[/\\])|\.(?:axon|pem|key|p12|pfx)$/i.test(
      name,
    ),
  );
  if (forbidden.length)
    throw new Error(
      `Private/development files in package (${forbidden.length}): ${forbidden.slice(0, 8).join(", ")}`,
    );
  return createHash("sha256")
    .update(await readFile(path.join(dir, "resources/app.asar")))
    .digest("hex");
}
try {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("This production pipeline targets Windows x64.");
  ensureClosed();
  await checkedOutput(release, service);
  if (await lstat(service).catch(() => null)) {
    if (
      (await readFile(path.join(service, "owner"), "utf8")) !==
      "Axon Windows staging\n"
    )
      throw new Error("Unrecognized staging directory; nothing removed.");
    if (await lstat(previous).catch(() => null))
      throw new Error(
        `Unresolved previous copy: ${previous}; nothing removed.`,
      );
  } else {
    await mkdir(service, { recursive: true });
    await writeFile(path.join(service, "owner"), "Axon Windows staging\n");
  }
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run this pipeline with npm run dist:win.");
  run([npm, "run", "lint"]);
  run([npm, "test"]);
  run([npm, "run", "build"]); // includes tsc --noEmit
  await checkedOutput(release, output);
  await rm(output, { recursive: true, force: true });
  run([
    "node_modules/electron-builder/cli.js",
    "--win",
    "--x64",
    "--dir",
    "--publish",
    "never",
    `--config.directories.output=${output}`,
  ]);
  const sha256 = await audit(staged);
  run(["tests/packaged.mjs"], {
    AXON_EXECUTABLE: path.join(staged, "Axon.exe"),
  });
  await writeFile(
    path.join(staged, "build-info.json"),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        sha256,
        command: "npm run dist:win",
        architecture: "x64",
      },
      null,
      2,
    ),
  );
  ensureClosed();
  await replaceApplication(
    release,
    staged,
    canonical,
    previous,
    async (dir) => {
      if ((await audit(dir)) !== sha256)
        throw new Error(
          "Published resources differ from the verified package.",
        );
      run(["tests/packaged.mjs"], {
        AXON_EXECUTABLE: path.join(dir, "Axon.exe"),
      });
    },
  );
  await checkedOutput(release, output);
  await rm(output, { recursive: true, force: true });
  console.log(
    `UPDATED AND LAUNCHED: ${path.join(canonical, "Axon.exe")}\napp.asar SHA-256: ${sha256}`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
