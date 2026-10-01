import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileWorkspace } from "../electron/workspace";
import { emptyDocument, serializeDocument } from "../src/model/document";
import * as model from "../src/model/document";

const io = vi.hoisted(() => ({
  beforeWrite: vi.fn(async () => {}),
  afterWrite: vi.fn(async () => {}),
  failRealpath: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, realpath: async (file: string) => {
    if (io.failRealpath) throw new Error("metadata lookup unavailable");
    return fs.realpath(file);
  } };
});
vi.mock("../electron/storage", async (original) => {
  const storage = await original<typeof import("../electron/storage")>();
  return {
    ...storage,
    writePreparedDocument: async (...args: Parameters<typeof storage.writeDocument>) => {
      await io.beforeWrite();
      const result = await storage.writeDocument(...args);
      await io.afterWrite();
      return result;
    },
  };
});

const dirs: string[] = [];
async function file() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "axon-review-save-"));
  dirs.push(dir);
  return path.join(dir, "document.axon");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(async () => {
  vi.restoreAllMocks();
  io.beforeWrite.mockReset().mockResolvedValue(undefined);
  io.afterWrite.mockReset().mockResolvedValue(undefined);
  io.failRealpath = false;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("workspace save ordering and saved content", () => {
  it("keeps UI-only state and content comparisons away from serialization", () => {
    const workspace = new FileWorkspace();
    const tab = workspace.add();
    const serialize = vi.spyOn(model, "serializeDocument");
    for (let i = 0; i < 10; i++) {
      workspace.update(tab.sessionId, { ...tab.document, title: `edit ${i}` });
      workspace.updateView(tab.sessionId, { camera: { x: i, y: 0, zoom: 1 }, selection: [] });
    }
    expect(tab.dirty).toBe(true);
    workspace.update(tab.sessionId, model.parseDocument(tab.savedContent));
    expect(tab.dirty).toBe(false);
    expect(serialize).not.toHaveBeenCalled();
  });

  it("serializes save requests before asynchronous preparation so an older write cannot finish last", async () => {
    const target = await file(), workspace = new FileWorkspace();
    const tab = workspace.add(), first = { ...tab.document, title: "first" };
    const second = { ...first, title: "second" };
    const slow = deferred(), started = deferred();
    io.beforeWrite.mockImplementationOnce(async () => { started.resolve(); await slow.promise; });
    workspace.update(tab.sessionId, first);
    const savingFirst = workspace.save(tab, target, first);
    await started.promise;
    workspace.update(tab.sessionId, second);
    const savingSecond = workspace.save(tab, target, second);
    await Promise.resolve();
    expect(io.beforeWrite).toHaveBeenCalledTimes(1);
    slow.resolve();
    await Promise.all([savingFirst, savingSecond]);
    expect(JSON.parse(await readFile(target, "utf8")).title).toBe("second");
    expect(tab.savedContent).toBe(serializeDocument(second));
    expect(tab.dirty).toBe(false);
  });

  it("marks only the written snapshot saved while another tab and newer edits exist", async () => {
    const target = await file(), workspace = new FileWorkspace();
    const tab = workspace.add(), snapshot = { ...tab.document, title: "A" };
    const slow = deferred(), started = deferred();
    io.beforeWrite.mockImplementationOnce(async () => { started.resolve(); await slow.promise; });
    workspace.update(tab.sessionId, snapshot);
    const saving = workspace.save(tab, target, snapshot);
    await started.promise;
    const other = workspace.add();
    workspace.update(tab.sessionId, { ...snapshot, title: "B" });
    slow.resolve();
    await saving;
    expect(workspace.active).toBe(other);
    expect(tab.dirty).toBe(true);
    expect(other.dirty).toBe(false);
    workspace.update(tab.sessionId, snapshot);
    expect(tab.dirty).toBe(false);
  });

  it("preserves dirty/path/saved state on failure and allows retry", async () => {
    const target = await file(), workspace = new FileWorkspace();
    const tab = workspace.add(), baseline = tab.savedContent;
    workspace.update(tab.sessionId, { ...tab.document, title: "unsaved" });
    io.beforeWrite.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(workspace.save(tab, target, tab.document)).rejects.toThrow("disk unavailable");
    expect(tab.path).toBeNull();
    expect(tab.savedContent).toBe(baseline);
    expect(tab.dirty).toBe(true);
    expect(await workspace.save(tab, target, tab.document)).toBe(tab.path);
    expect(tab.dirty).toBe(false);
  });

  it("rejects queued saves belonging to a closed session", async () => {
    const target = await file(), workspace = new FileWorkspace();
    const first = workspace.add(), second = workspace.add(emptyDocument());
    const slow = deferred(), started = deferred();
    io.beforeWrite.mockImplementationOnce(async () => { started.resolve(); await slow.promise; });
    const active = workspace.save(first, target, first.document);
    await started.promise;
    const queued = workspace.save(second, target, second.document);
    const rejected = expect(queued).rejects.toThrow(/закрыта/);
    workspace.remove(second.sessionId);
    slow.resolve();
    await active;
    await rejected;
    expect(io.beforeWrite).toHaveBeenCalledTimes(1);
  });

  it("keeps the successful written state if a later realpath lookup fails", async () => {
    const target = await file(), workspace = new FileWorkspace();
    const tab = workspace.add();
    workspace.update(tab.sessionId, { ...tab.document, title: "written" });
    io.afterWrite.mockImplementationOnce(async () => { io.failRealpath = true; });
    expect(await workspace.save(tab, target, tab.document)).toBe(target);
    expect(tab.path).toBe(target);
    expect(tab.dirty).toBe(false);
    expect(JSON.parse(await readFile(target, "utf8")).title).toBe("written");
  });
});
