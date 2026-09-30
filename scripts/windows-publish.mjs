import { lstat, access, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export async function checkedOutput(root, target) {
  const base = path.resolve(root),
    resolved = path.resolve(target);
  if (resolved === base || !resolved.startsWith(base + path.sep))
    throw new Error(`Unsafe output path: ${resolved}`);
  for (let p = resolved; p !== path.dirname(base); p = path.dirname(p)) {
    const stat = await lstat(p).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat?.isSymbolicLink())
      throw new Error(`Output must not be a link: ${p}`);
  }
  return resolved;
}
export async function applicationFiles(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in application: ${name}`);
    if (entry.isDirectory()) files.push(...await applicationFiles(dir, name));
    else files.push(name);
  }
  return files;
}
export async function replaceApplication(
  root,
  staged,
  canonical,
  previous,
  verify,
) {
  for (const dir of [staged, canonical, previous])
    await checkedOutput(root, dir);
  await access(path.join(staged, "Axon.exe"));
  await access(path.join(staged, "resources/app.asar"));
  if (await lstat(canonical).catch(() => null)) {
    const prepared = new Set(await applicationFiles(staged));
    const legacyRuntime = new Set(["build-info.json", "resources/elevate.exe", "resources/app-update.yml"]);
    const unknown = (await applicationFiles(canonical)).filter(name => /\.(axon|png|jpg|jpeg|pdf|svg)$/i.test(name) || (!prepared.has(name) && !legacyRuntime.has(name)));
    if (unknown.length) throw new Error(`Unknown/user files in application folder; nothing replaced: ${unknown.join(", ")}. Move these files out before updating.`);
  }
  if (await lstat(previous).catch(() => null))
    throw new Error(
      `Previous recovery copy exists: ${previous}. Resolve the previous publication first.`,
    );
  const hadPrevious = !!(await lstat(canonical).catch(() => null));
  let installed = false,
    moved = false;
  try {
    if (hadPrevious) {
      await rename(canonical, previous);
      moved = true;
    }
    await rename(staged, canonical);
    installed = true;
    await verify(canonical);
  } catch (error) {
    try {
      if (installed) await rename(canonical, staged);
      if (moved) await rename(previous, canonical);
    } catch (rollbackError) {
      throw new Error(
        `Publication failed: ${error.message}. Rollback failed: ${rollbackError.message}. Previous complete copy: ${previous}`,
        { cause: rollbackError },
      );
    }
    throw new Error(
      `Publication failed; previous application preserved: ${error.message}`,
      { cause: error },
    );
  }
  if (hadPrevious) {
    await checkedOutput(root, previous);
    await rm(previous, { recursive: true });
  }
}
