import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as documentModel from "../src/model/document";
import { Editor } from "../src/editor/store";
import { defaults, type Session } from "../src/shared/contracts";
import { fitText, registerFonts } from "../src/rendering/text";
import {
  DocumentContentState,
  documentContentEqual,
} from "../src/model/content";

beforeAll(() => {
  const font = (name: string) =>
    new Uint8Array(readFileSync(`public/fonts/${name}.ttf`)).buffer;
  registerFonts(font("NotoSans-Regular"), font("NotoSansMono-Regular"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
function fixture() {
  const document = documentModel.emptyDocument();
  document.objects = [
    fitText({
      ...documentModel.createObject(
        "text",
        { x: 0, y: 0 },
        document.background,
      ),
      text: "А",
    }),
    documentModel.createObject("shape", { x: 300, y: 0 }, document.background),
    documentModel.createObject(
      "connector",
      { x: 0, y: 200 },
      document.background,
    ),
  ];
  const editor = new Editor();
  editor.load(session(document));
  return editor;
}

describe("review: exact saved document state", () => {
  it("retains exact equality through incremental array/asset insertions, removals and saved baseline changes", () => {
    const first = fixture().state.doc;
    const content = new DocumentContentState(first, first);
    let current = first;
    const removed = { ...first, objects: first.objects.slice(1) };
    const reversed = { ...first, objects: [...first.objects].reverse() };
    const states = [
      removed,
      reversed,
      structuredClone(first),
      { ...first, objects: [] },
      first,
    ];
    for (const saved of states) {
      content.markSaved(saved);
      expect(content.dirty).toBe(!documentContentEqual(current, saved));
      for (const next of states) {
        content.update(next);
        current = next;
        expect(content.dirty).toBe(
          documentModel.serializeDocument(next) !==
            documentModel.serializeDocument(saved),
        );
      }
    }
    content.markSaved(null);
    content.update(removed);
    expect(content.dirty).toBe(true);
  });

  it("validates changed text and styles without parsing unrelated assets", () => {
    const editor = fixture();
    const document = {
      ...editor.state.doc,
      assets: {
        large: {
          id: "large",
          mime: "image/png" as const,
          data: "iVBORw0KGgo" + "A".repeat(1_000_000),
          width: 1,
          height: 1,
        },
      },
    };
    editor.change(() => document);
    editor.acceptSession(session(editor.state.doc));
    const parse = vi.spyOn(documentModel.documentSchema, "safeParse");
    const stringify = vi.spyOn(JSON, "stringify");
    editor.beginText(document.objects[0].id);
    editor.updateText("Привет\nМир");
    editor.style({ color: "#123456" });
    editor.endText();
    expect(editor.isDirty()).toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
  });

  it("does not serialize or stringify documents for edits, no-op commits or UI state", () => {
    const editor = fixture();
    const serialize = vi.spyOn(documentModel, "serializeDocument");
    const stringify = vi.spyOn(JSON, "stringify");
    editor.change((doc) => ({ ...doc, title: "Изменено" }));
    editor.change((doc) => ({ ...doc, objects: [...doc.objects] }));
    for (let i = 0; i < 20; i++) {
      editor.set({ camera: { x: i, y: i, zoom: 1 }, selection: [] });
      expect(editor.isDirty()).toBe(true);
    }
    expect(serialize).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    editor.undo();
    expect(editor.isDirty()).toBe(false);
  });

  it("distinguishes saved content from history position and a new branch", () => {
    const editor = fixture();
    editor.change((doc) => ({ ...doc, title: "Saved" }));
    editor.acceptSession(session(editor.state.doc));
    editor.change((doc) => ({ ...doc, title: "Later" }));
    editor.undo();
    expect(editor.isDirty()).toBe(false);
    editor.redo();
    expect(editor.isDirty()).toBe(true);
    editor.undo();
    editor.undo();
    editor.change((doc) => ({ ...doc, title: "Different branch" }));
    expect(editor.history.canRedo).toBe(false);
    expect(editor.isDirty()).toBe(true);
  });

  it("recognizes manually restored styles, metadata, object order and assets", () => {
    const editor = fixture();
    const original = editor.state.doc;
    editor.select([original.objects[1].id]);
    editor.style({ fill: "#123456" });
    expect(editor.isDirty()).toBe(true);
    editor.style({ fill: original.objects[1].style.fill });
    expect(editor.isDirty()).toBe(false);
    editor.change((doc) => ({ ...doc, background: "#123456" }));
    editor.change((doc) => ({ ...doc, background: original.background }));
    expect(editor.isDirty()).toBe(false);
    editor.change((doc) => ({ ...doc, objects: [...doc.objects].reverse() }));
    expect(editor.isDirty()).toBe(true);
    editor.change((doc) => ({ ...doc, objects: [...doc.objects].reverse() }));
    expect(editor.isDirty()).toBe(false);
    const asset: documentModel.Asset = {
      id: "image",
      mime: "image/png",
      data: "iVBORw0KGgoAAA==",
      width: 1,
      height: 1,
    };
    editor.change((doc) => ({ ...doc, assets: { image: asset } }));
    expect(editor.isDirty()).toBe(true);
    editor.change((doc) => ({ ...doc, assets: {} }));
    expect(editor.isDirty()).toBe(false);
  });

  it("does not create history for identical styles, cloned content or returned previews", () => {
    const editor = fixture();
    const before = editor.state.doc;
    editor.select([before.objects[0].id]);
    editor.style({ fill: before.objects[0].style.fill });
    editor.change((doc) => structuredClone(doc));
    editor.preview({ ...before, title: "temporary" });
    expect(editor.isDirty()).toBe(true);
    editor.preview(before);
    editor.commit(before, { ...before, objects: [...before.objects] });
    expect(editor.state.doc).toBe(before);
    expect(editor.history.canUndo).toBe(false);
    expect(editor.isDirty()).toBe(false);
  });

  it("keeps the saved snapshot after history pruning and text command boundaries", () => {
    const editor = fixture();
    const original = editor.state.doc;
    for (let i = 0; i < 105; i++)
      editor.change((doc) => ({ ...doc, title: `Change ${i}` }));
    for (let i = 0; i < 100; i++) editor.undo();
    expect(editor.history.canUndo).toBe(false);
    expect(editor.isDirty()).toBe(true);
    editor.change((doc) => ({ ...doc, title: original.title }));
    expect(editor.isDirty()).toBe(false);
    const id = original.objects[0].id;
    editor.beginText(id);
    editor.updateText("Б");
    editor.finishOperation();
    const saved = editor.state.doc;
    editor.acceptSession(session(saved));
    editor.beginText(id);
    editor.updateText("В");
    editor.style({ color: "#123456" });
    editor.updateText("Г");
    editor.endText();
    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.state.doc).toBe(saved);
    expect(editor.isDirty()).toBe(false);
    expect("text" in saved.objects[0] && saved.objects[0].text).toBe("Б");
  });

  it("acknowledges async snapshot A while B changes and another tab is active", async () => {
    const editor = fixture();
    const firstId = editor.state.sessionId;
    editor.change((doc) => ({ ...doc, title: "Snapshot A" }));
    const snapshotA = editor.state.doc;
    let complete!: (result: Session) => void;
    const saving = new Promise<Session>((resolve) => {
      complete = resolve;
    });
    const accepted = saving.then((result) => editor.acceptSession(result));
    editor.change((doc) => ({ ...doc, title: "New edit B" }));
    const second = session();
    editor.load(second);
    editor.change((doc) => ({ ...doc, title: "Second tab edit" }));
    complete(session(snapshotA));
    await accepted;
    expect(editor.state.sessionId).toBe(second.document.id);
    expect(editor.isDirty(firstId)).toBe(true);
    expect(editor.isDirty(second.document.id)).toBe(true);
    editor.activate(firstId);
    editor.undo();
    expect(editor.isDirty()).toBe(false);
    editor.activate(second.document.id);
    editor.undo();
    expect(editor.isDirty()).toBe(false);
    editor.activate(firstId);
    editor.redo();
    expect(editor.isDirty()).toBe(true);
  });

  it("finishes text and gesture preview before snapshots and switching tabs", () => {
    const editor = fixture();
    const firstId = editor.state.sessionId;
    const before = editor.state.doc;
    editor.preview({ ...before, title: "Gesture preview" });
    editor.finishGesture = vi.fn(() => editor.commit(before));
    editor.finishOperation();
    expect(editor.finishGesture).toHaveBeenCalledOnce();
    expect(editor.history.canUndo).toBe(true);
    editor.finishGesture = null;
    editor.beginText(before.objects[0].id);
    editor.updateText("Незавершённый ввод");
    const second = session();
    editor.load(second);
    expect(editor.tabs.get(firstId)?.state.editing).toBeNull();
    editor.activate(firstId);
    expect(
      "text" in editor.state.doc.objects[0] && editor.state.doc.objects[0].text,
    ).toBe("Незавершённый ввод");
    editor.undo();
    expect(
      "text" in editor.state.doc.objects[0] && editor.state.doc.objects[0].text,
    ).toBe("А");
    expect(editor.state.doc.title).toBe("Gesture preview");
  });
});

describe("review: selected styles and creation defaults", () => {
  it("applies mixed selection styles without changing defaults and ignores missing ids", () => {
    const editor = fixture();
    const prefs = editor.state.prefs;
    editor.select(editor.state.doc.objects.map((o) => o.id));
    editor.style({ color: "#123456" });
    expect(
      editor.state.doc.objects.every((o) => o.style.color === "#123456"),
    ).toBe(true);
    expect(editor.state.prefs).toBe(prefs);
    editor.undo();
    editor.set({ selection: ["missing"] });
    editor.style({ color: "#123456" });
    expect(editor.state.prefs).toBe(prefs);
    expect(editor.history.canUndo).toBe(false);
  });

  it("stores unselected tool defaults inherited by new objects without changing document dirty", () => {
    const preferences = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { axon: { preferences } });
    const editor = fixture();
    const before = editor.state.doc;
    for (const tool of ["shape", "text", "connector"] as const) {
      editor.setTool(tool);
      editor.style({ color: "#123456" });
      expect(editor.newObject(tool, { x: 0, y: 0 }).style.color).toBe(
        "#123456",
      );
    }
    expect(editor.state.doc).toBe(before);
    expect(editor.isDirty()).toBe(false);
    expect(editor.history.canUndo).toBe(false);
    expect(preferences).toHaveBeenCalledTimes(3);
  });
});
