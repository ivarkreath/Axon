import { it, expect } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, readDocument, writeDocument } from "../electron/storage";
import { createObject, emptyDocument } from "../src/model/document";
it("writes complete documents atomically and rejects corrupt input without changing the original", async () => {
  const dir = path.resolve("artifacts/storage-test-" + crypto.randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const file = path.join(dir, "test.axon");
    const d = emptyDocument();
    await writeDocument(file, d);
    expect(await readDocument(file)).toEqual(d);
    const before = await readFile(file, "utf8");
    await expect(atomicWrite(dir, "invalid target")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
    await writeFile(path.join(dir, "corrupt.axon"), "{");
    await expect(readDocument(path.join(dir, "corrupt.axon"))).rejects.toThrow(
      /повреждён/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects oversized UTF-8 documents before replacing the last readable file", async () => {
  const dir = path.resolve(
    "artifacts/storage-size-test-" + crypto.randomUUID(),
  );
  const file = path.join(dir, "test.axon");
  const original = emptyDocument();
  try {
    await writeDocument(file, original);
    const text = createObject("text", { x: 0, y: 0 }, original.background);
    const large = {
      ...original,
      objects: Array.from({ length: 2100 }, (_, i) => ({
        ...text,
        id: `large-${i}`,
        type: "text" as const,
        text: "Я".repeat(20000),
      })),
    };
    await expect(writeDocument(file, large)).rejects.toThrow(/80 МБ/);
    expect(await readDocument(file)).toEqual(original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
