import { afterEach, describe, expect, it, vi } from "vitest";
import * as documentModel from "../src/model/document";
import { Editor } from "../src/editor/store";
import { defaults, type Session } from "../src/shared/contracts";

function session(document = documentModel.emptyDocument()): Session {
  return {
    sessionId: document.id,
    document,
    path: null,
    dirty: false,
    savedContent: documentModel.serializeDocument(document),
    preferences: defaults,
    recents: [],
    recovered: false,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("editor dirty-state validation", () => {
  it("does not revalidate and serialize unchanged documents for camera and selection updates", () => {
    const editor = new Editor();
    editor.load(session());
    const serialize = vi.spyOn(documentModel, "serializeDocument");

    expect(editor.isDirty()).toBe(false);
    for (let i = 0; i < 20; i++) {
      editor.set({ camera: { x: i, y: -i, zoom: 1 }, selection: [] });
      expect(editor.isDirty()).toBe(false);
      expect(editor.isDirty()).toBe(false);
    }
    expect(serialize).not.toHaveBeenCalled();
  });

  it("rechecks document edits, undo and redo against the saved content", () => {
    const editor = new Editor();
    editor.load(session());
    expect(editor.isDirty()).toBe(false);
    editor.change((doc) => ({ ...doc, title: "Changed" }));
    expect(editor.isDirty()).toBe(true);
    editor.undo();
    expect(editor.isDirty()).toBe(false);
    editor.redo();
    expect(editor.isDirty()).toBe(true);
  });

  it("invalidates a saved baseline without replacing newer renderer edits", () => {
    const editor = new Editor();
    const original = session();
    editor.load(original);
    editor.change((doc) => ({ ...doc, title: "Saved snapshot" }));
    const saved = session(editor.state.doc);
    expect(editor.isDirty()).toBe(true);

    editor.acceptSession(saved);
    expect(editor.isDirty()).toBe(false);
    editor.change((doc) => ({ ...doc, title: "Newer edit" }));
    const latest = editor.state.doc;
    expect(editor.isDirty()).toBe(true);

    editor.acceptSession(original);
    expect(editor.state.doc).toBe(latest);
    expect(editor.isDirty()).toBe(true);
    editor.acceptSession(session(latest));
    expect(editor.state.doc).toBe(latest);
    expect(editor.isDirty()).toBe(false);
  });

  it("keeps validation results independent across tabs and discards closed tabs", () => {
    const editor = new Editor();
    const first = session(), second = session();
    editor.load(first);
    editor.load(second);
    const serialize = vi.spyOn(documentModel, "serializeDocument");
    expect(editor.isDirty(first.document.id)).toBe(false);
    expect(editor.isDirty(second.document.id)).toBe(false);
    editor.activate(first.document.id);
    editor.change((doc) => ({ ...doc, title: "First modified" }));
    expect(editor.isDirty(first.document.id)).toBe(true);
    expect(editor.isDirty(second.document.id)).toBe(false);
    expect(serialize).not.toHaveBeenCalled();

    editor.closeSession(first.document.id, second);
    expect(editor.isDirty(first.document.id)).toBe(false);
    editor.load({ ...first, savedContent: "", dirty: true });
    expect(editor.isDirty(first.document.id)).toBe(true);
    expect(editor.isDirty(second.document.id)).toBe(false);
    expect(serialize).not.toHaveBeenCalled();
  });
});
