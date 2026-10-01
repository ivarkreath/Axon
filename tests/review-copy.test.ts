import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../src/editor/store";
import {
  createObject,
  emptyDocument,
  parseDocument,
  serializeDocument,
  type AxonDocument,
  type AxonObject,
  type Connector,
} from "../src/model/document";
import { copySubset, pasteObjects } from "../src/model/operations";

type Node = Extract<AxonObject, { type: "shape" }>;

function tree(prefix = ""): AxonDocument {
  const doc = emptyDocument();
  for (const [index, name] of ["root", "parent", "child"].entries()) {
    const node = createObject("shape", { x: index * 200, y: 0 }, doc.background);
    if (node.type !== "shape") throw new Error("Expected shape");
    node.id = prefix + name;
    node.text = node.id;
    node.mind = {
      treeId: prefix + "root",
      parentId: index ? prefix + (index === 1 ? "root" : "parent") : null,
      order: 0,
    };
    doc.objects.push(node);
    if (!node.mind.parentId) continue;
    const branch = createObject("connector", node, doc.background) as Connector;
    branch.id = prefix + name + "-branch";
    branch.mindBranch = node.id;
    branch.start = { type: "bound", nodeId: node.mind.parentId, side: "right" };
    branch.end = { type: "bound", nodeId: node.id, side: "left" };
    doc.objects.push(branch);
  }
  return doc;
}

function node(doc: AxonDocument, id: string): Node {
  const result = doc.objects.find((object) => object.id === id);
  if (result?.type !== "shape") throw new Error(`Missing shape ${id}`);
  return result;
}

function cyclicTree(): AxonDocument {
  const doc = tree();
  const root = node(doc, "root");
  // Keep a future regression from hanging the entire test worker. The getter
  // returns the same cyclic parent on every read until traversal is unbounded.
  let reads = 0;
  Object.defineProperty(root.mind!, "parentId", {
    enumerable: true,
    get() {
      if (++reads > 100) throw new Error("Unbounded mind map traversal");
      return "child";
    },
  });
  return doc;
}

afterEach(() => vi.unstubAllGlobals());

describe("mind map copy regression", () => {
  it.each([false, true])(
    "copies an internal subtree independently of source stacking order (reverse=%s)",
    (reverse) => {
      const doc = tree();
      if (reverse) doc.objects.reverse();
      const original = structuredClone(doc);
      for (const selection of [["parent", "child"], ["child", "parent"]]) {
        const copied = copySubset(doc, selection);
        expect(copied.objects.map((object) => object.id)).toEqual(
          doc.objects.filter((object) => ["parent", "child", "child-branch"].includes(object.id)).map((object) => object.id),
        );
        expect(node(copied, "parent").mind).toMatchObject({ parentId: null, treeId: "parent" });
        expect(node(copied, "child").mind).toMatchObject({ parentId: "parent", treeId: "parent" });
        expect(parseDocument(serializeDocument(copied))).toEqual(copied);
        expect(doc).toEqual(original);
      }
    },
  );

  it("copies one leaf and multiple independent internal branches as a forest", () => {
    const doc = tree();
    doc.objects.push(...tree("other-").objects);
    const leaf = copySubset(doc, ["child"]);
    expect(leaf.objects).toHaveLength(1);
    expect(node(leaf, "child").mind).toMatchObject({ parentId: null, treeId: "child" });
    const forest = copySubset(doc, ["other-parent", "parent"]);
    expect(forest.objects).toHaveLength(6);
    for (const prefix of ["", "other-"]) {
      expect(node(forest, prefix + "parent").mind).toMatchObject({ parentId: null, treeId: prefix + "parent" });
      expect(node(forest, prefix + "child").mind).toMatchObject({ parentId: prefix + "parent", treeId: prefix + "parent" });
    }
    expect(parseDocument(serializeDocument(forest))).toEqual(forest);
  });

  it("allocates fresh IDs on paste, retains internal links and detaches external ordinary endpoints", () => {
    const doc = tree();
    const link = createObject("connector", { x: 0, y: 0 }, doc.background) as Connector;
    link.id = "external";
    link.start = { type: "bound", nodeId: "parent", side: "top" };
    link.end = { type: "bound", nodeId: "root", side: "bottom" };
    doc.objects.push(link);
    const original = structuredClone(doc);
    const source = copySubset(doc, ["parent", "external"]);
    const pasted = pasteObjects(doc, source);
    const copies = pasted.doc.objects.filter((object) => pasted.ids.includes(object.id));
    expect(pasted.ids.every((id) => !doc.objects.some((object) => object.id === id))).toBe(true);
    const parent = copies.find((object) => object.type === "shape" && object.text === "parent") as Node;
    const child = copies.find((object) => object.type === "shape" && object.text === "child") as Node;
    expect(parent.mind).toMatchObject({ parentId: null, treeId: parent.id });
    expect(child.mind).toMatchObject({ parentId: parent.id, treeId: parent.id });
    const branch = copies.find((object) => object.type === "connector" && object.mindBranch) as Connector;
    expect(branch.mindBranch).toBe(child.id);
    expect(branch.start).toMatchObject({ type: "bound", nodeId: parent.id });
    expect(branch.end).toMatchObject({ type: "bound", nodeId: child.id });
    const external = copies.find((object) => object.type === "connector" && !object.mindBranch) as Connector;
    expect(external.start).toMatchObject({ type: "bound", nodeId: parent.id });
    expect(external.end).toMatchObject({ type: "free" });
    expect(doc).toEqual(original);
    expect(parseDocument(serializeDocument(pasted.doc))).toEqual(pasted.doc);
  });

  it.each(["duplicate", "clipboard"])("preserves copy/%s through Undo, Redo and save/reopen", async (action) => {
    const doc = tree();
    const editor = new Editor();
    editor.set({ doc, selection: ["parent"] });
    let clipboard = emptyDocument();
    vi.stubGlobal("window", {
      axon: {
        writeClipboard: vi.fn(async (value: AxonDocument) => { clipboard = parseDocument(value); }),
        readClipboard: vi.fn(async () => ({ document: clipboard })),
      },
    });
    if (action === "duplicate") editor.duplicate();
    else {
      await editor.copy();
      await editor.paste();
    }
    const after = editor.state.doc;
    expect(after.objects).toHaveLength(doc.objects.length + 3);
    expect(parseDocument(serializeDocument(after))).toEqual(after);
    editor.undo();
    expect(editor.state.doc).toEqual(doc);
    editor.redo();
    expect(editor.state.doc).toEqual(after);
  });

  it("detaches a missing external parent internally while rejecting the damaged source at input", () => {
    const doc = tree();
    node(doc, "parent").mind!.parentId = "missing";
    expect(() => parseDocument(doc)).toThrow();
    const copied = copySubset(doc, ["parent"]);
    expect(node(copied, "parent").mind).toMatchObject({ parentId: null, treeId: "parent" });
    expect(parseDocument(copied)).toEqual(copied);
  });
});

describe("invalid internal mind map copy", () => {
  it("rejects cyclic ancestry without an unbounded traversal or changing input", () => {
    const doc = cyclicTree();
    expect(() => parseDocument(doc)).toThrow();
    const copied = copySubset(doc, ["root"]);
    expect(copied.objects).toEqual([]);
    expect(node(doc, "root").mind!.parentId).toBe("child");
  });

  it("rejects a retained parent that is not a mind map node", () => {
    const doc = tree();
    delete node(doc, "root").mind;
    expect(() => parseDocument(doc)).toThrow();
    expect(copySubset(doc, ["root"]).objects).toEqual([]);
  });

  it("rejects duplicate internal IDs before paste could map them to the same new ID", () => {
    const doc = tree();
    doc.objects.push({ ...node(doc, "root") });
    expect(() => parseDocument(doc)).toThrow();
    expect(copySubset(doc, ["root"]).objects).toEqual([]);
  });

  it("leaves clipboard, selection and history intact on rejected internal copy/duplicate", async () => {
    const doc = cyclicTree();
    const editor = new Editor();
    editor.set({ doc, selection: ["root"] });
    const writeClipboard = vi.fn();
    vi.stubGlobal("window", { axon: { writeClipboard } });
    await editor.copy();
    editor.duplicate();
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection).toEqual(["root"]);
    expect(editor.history.canUndo).toBe(false);
  });
});
