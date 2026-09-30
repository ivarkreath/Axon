import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { FileWorkspace, fingerprint } from "../electron/workspace";
import { emptyDocument, serializeDocument } from "../src/model/document";
import { Editor } from "../src/editor/store";
import { defaults, type Session } from "../src/shared/contracts";
const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "axon-tabs-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("isolated document sessions", () => {
  it("fingerprints multi-chunk files, returns null for missing files and propagates read failures", async () => {
    const dir = await directory();
    const file = path.join(dir, "fingerprint.axon");
    const bytes = Buffer.from("Файл с внешними изменениями\n".repeat(10000));
    await writeFile(file, bytes);
    expect(await fingerprint(file)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(await fingerprint(path.join(dir, "missing.axon"))).toBeNull();
    await expect(fingerprint(dir)).rejects.toThrow();
  });

  it("keeps undo, selection, camera and dirty state per tab", () => {
    const e = new Editor(),
      a = emptyDocument(),
      b = emptyDocument();
    const session = (document: typeof a): Session => ({
      sessionId: document.id,
      document,
      path: null,
      dirty: false,
      savedContent: serializeDocument(document),
      preferences: defaults,
      recents: [],
      recovered: false,
    });
    e.load(session(a));
    e.change((d) => ({ ...d, title: "A modified" }));
    e.set({ camera: { x: 13, y: -20, zoom: 0.25 }, selection: ["selected-A"] });
    e.load(session(b));
    e.change((d) => ({ ...d, title: "B modified" }));
    e.undo();
    expect(e.state.doc.title).toBe(b.title);
    e.activate(a.id);
    expect(e.state.doc.title).toBe("A modified");
    expect(e.state.camera.zoom).toBe(0.25);
    expect(e.state.selection).toEqual(["selected-A"]);
    expect(e.isDirty()).toBe(true);
    e.undo();
    expect(e.isDirty()).toBe(false);
    e.activate(b.id);
    expect(e.history.canRedo).toBe(true);
  });
  it("pins async saves to their original snapshot while another tab and newer edits are active", async () => {
    const dir = await directory(),
      w = new FileWorkspace();
    const a = w.add(),
      original = { ...a.document, title: "A saved snapshot" };
    w.update(a.sessionId, original);
    const saving = w.save(a, path.join(dir, "A.axon"), original);
    const b = w.add();
    w.update(a.sessionId, { ...original, title: "A newer edit" });
    await saving;
    expect(w.active).toBe(b);
    expect(a.dirty).toBe(true);
    expect(a.savedContent).toBe(serializeDocument(original));
    expect(JSON.parse(await readFile(a.path!, "utf8")).title).toBe(
      "A saved snapshot",
    );
    const e = new Editor();
    e.load({ ...a, preferences: defaults, recents: [] });
    e.change((d) => ({ ...d, title: "yet newer" }));
    e.load({ ...b, preferences: defaults, recents: [] });
    e.acceptSession({ ...a, preferences: defaults, recents: [] });
    expect(e.state.sessionId).toBe(b.sessionId);
    expect(e.isDirty(a.sessionId)).toBe(true);
  });
  it("deduplicates real files but not equal names, rejects corrupt opens and detects external changes", async () => {
    const dir = await directory(),
      w = new FileWorkspace(),
      doc = emptyDocument();
    await mkdir(path.join(dir, "one"));
    await mkdir(path.join(dir, "two"));
    const one = path.join(dir, "one", "same.axon"),
      two = path.join(dir, "two", "same.axon");
    await writeFile(one, serializeDocument(doc));
    await writeFile(two, serializeDocument(doc));
    const a = await w.open(one);
    expect(await w.open(path.join(dir, "one", ".", "same.axon"))).toBe(a);
    expect(w.tabs.size).toBe(1);
    const b = await w.open(two);
    expect(b.sessionId).not.toBe(a.sessionId);
    await writeFile(two, "broken");
    await expect(w.open(path.join(dir, "missing.axon"))).rejects.toThrow();
    expect(w.active).toBe(b);
    expect(await w.conflict(b, two)).toBe(true);
    await rm(one);
    expect(await w.conflict(a, one)).toBe(true);
    const restored = new FileWorkspace();
    await restored.restore(w.snapshot());
    expect(restored.tabs.get(a.sessionId)!.unavailable).toBe(true);
    expect(restored.tabs.get(a.sessionId)!.document).toEqual(a.document);
    w.remove(a.sessionId);
    expect(w.snapshot().tabs.some((t) => t.sessionId === a.sessionId)).toBe(
      false,
    );
  });
});
