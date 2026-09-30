import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import path from "node:path";
import {
  checkedOutput,
  replaceApplication,
} from "../scripts/windows-publish.mjs";
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await checkedOutput(path.resolve("artifacts"), root);
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  await mkdir("artifacts", { recursive: true });
  const root = await mkdtemp(path.resolve("artifacts/publish-test-"));
  roots.push(root);
  const staged = path.join(root, "stage"),
    canonical = path.join(root, "app"),
    previous = path.join(root, "previous");
  for (const [dir, version] of [
    [staged, "new"],
    [canonical, "old"],
  ]) {
    await mkdir(path.join(dir, "resources"), { recursive: true });
    await writeFile(path.join(dir, "Axon.exe"), version);
    await writeFile(path.join(dir, "resources/app.asar"), version);
  }
  return { root, staged, canonical, previous };
}
describe("whole application publication", () => {
  it("refuses to replace a folder containing user documents", async () => {
    const { root, staged, canonical, previous } = await fixture();
    await writeFile(path.join(canonical, "My diagram.axon"), "user document");
    await expect(replaceApplication(root, staged, canonical, previous, async () => {})).rejects.toThrow("Unknown/user files");
    expect(await readFile(path.join(canonical, "My diagram.axon"), "utf8")).toBe("user document");
    expect(await readFile(path.join(canonical, "Axon.exe"), "utf8")).toBe("old");
  });
  it("publishes a complete verified directory and removes the service backup", async () => {
    const { root, staged, canonical, previous } = await fixture();
    await replaceApplication(root, staged, canonical, previous, async (dir) => {
      expect(await readFile(path.join(dir, "resources/app.asar"), "utf8")).toBe(
        "new",
      );
    });
    expect(await readFile(path.join(canonical, "Axon.exe"), "utf8")).toBe(
      "new",
    );
    await expect(access(previous)).rejects.toThrow();
  });
  it("restores the complete previous copy if the published application fails verification", async () => {
    const { root, staged, canonical, previous } = await fixture();
    await expect(
      replaceApplication(root, staged, canonical, previous, async () => {
        throw new Error("startup failed");
      }),
    ).rejects.toThrow("previous application preserved");
    expect(await readFile(path.join(canonical, "Axon.exe"), "utf8")).toBe(
      "old",
    );
    expect(
      await readFile(path.join(canonical, "resources/app.asar"), "utf8"),
    ).toBe("old");
    expect(await readFile(path.join(staged, "Axon.exe"), "utf8")).toBe("new");
  });
  it("refuses incomplete staging and paths outside the designated output", async () => {
    const { root, staged, canonical, previous } = await fixture();
    await rm(path.join(staged, "Axon.exe"));
    await expect(
      replaceApplication(root, staged, canonical, previous, async () => {}),
    ).rejects.toThrow();
    expect(await readFile(path.join(canonical, "Axon.exe"), "utf8")).toBe(
      "old",
    );
    await expect(checkedOutput(root, path.dirname(root))).rejects.toThrow(
      "Unsafe output path",
    );
  });
});
