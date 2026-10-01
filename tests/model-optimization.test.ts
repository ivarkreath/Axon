import { describe, expect, it } from "vitest";
import {
  createObject,
  documentSchema,
  emptyDocument,
  parseDocument,
  type AxonDocument,
  type AxonObject,
  type Connector,
} from "../src/model/document";
import { union } from "../src/model/geometry";
import { expandSelection } from "../src/model/operations";

function chain(count: number, prefix = "n"): AxonDocument {
  const doc = emptyDocument();
  for (let i = 0; i < count; i++) {
    const node = createObject("shape", { x: i, y: 0 }, doc.background);
    if (node.type !== "shape") throw new Error("shape");
    node.id = `${prefix}${i}`;
    node.mind = {
      treeId: `${prefix}0`,
      parentId: i ? `${prefix}${i - 1}` : null,
      order: 0,
    };
    doc.objects.push(node);
    if (!i) continue;
    const branch = createObject("connector", node, doc.background) as Connector;
    branch.id = `${prefix}-branch${i}`;
    branch.mindBranch = node.id;
    branch.start = { type: "bound", nodeId: `${prefix}${i - 1}`, side: "right" };
    branch.end = { type: "bound", nodeId: node.id, side: "left" };
    doc.objects.push(branch);
  }
  return doc;
}

describe("large document operations", () => {
  it("validates deep trees and expands their descendants regardless of stacking order", () => {
    const doc = chain(2000);
    doc.objects.reverse();
    expect(parseDocument(doc)).toEqual(doc);
    expect(expandSelection(doc, ["n0"])).toEqual(doc.objects.map((o) => o.id));
    expect(expandSelection(doc, ["n0"], false)).toEqual(["n0"]);
    const selected = expandSelection(doc, ["n1998", "n1998", "unknown"]);
    expect(selected).toEqual(["n-branch1999", "n1999", "n1998"]);
  });

  it("closes groups and descendants across trees while retaining document order", () => {
    const doc = chain(5);
    doc.objects.push(...chain(3, "other").objects);
    for (const o of doc.objects)
      if (o.id === "n1" || o.id === "other0") o.groupId = "shared";
    const extra = createObject("connector", { x: 0, y: 0 }, doc.background) as Connector;
    extra.id = "ordinary";
    extra.start = { type: "bound", nodeId: "n1", side: "right" };
    extra.end = { type: "bound", nodeId: "other0", side: "left" };
    doc.objects.push(extra);
    const expected = new Set([
      "n1", "n2", "n3", "n4", "n-branch2", "n-branch3", "n-branch4",
      "other0", "other1", "other2", "other-branch1", "other-branch2",
    ]);
    const orders = [doc.objects, [...doc.objects].reverse(), [extra, ...doc.objects.slice(0, -1)]];
    for (const objects of orders) {
      const ordered = { ...doc, objects };
      expect(expandSelection(ordered, ["n1"])).toEqual(
        objects.filter((o) => expected.has(o.id)).map((o) => o.id),
      );
      expect(expandSelection(ordered, ["n1"], false)).toEqual(
        objects.filter((o) => o.groupId === "shared").map((o) => o.id),
      );
      expect(expandSelection(ordered, ["n-branch1"])).toEqual(["n-branch1"]);
    }
  });

  it("calculates bounds beyond the JavaScript argument limit without mutating input", () => {
    const boxes = Array.from({ length: 200000 }, (_, i) => ({ x: -i, y: i, w: 3, h: 2 }));
    expect(union(boxes)).toEqual({ x: -199999, y: 0, w: 200002, h: 200001 });
    expect(boxes[0]).toEqual({ x: -0, y: 0, w: 3, h: 2 });
    expect(union([])).toBeNull();
  });
});

describe("document validation diagnostics", () => {
  const nodes = (doc: AxonDocument) => doc.objects.filter(
    (o): o is Extract<AxonObject, { type: "shape" }> => o.type === "shape",
  );
  it.each(["missing parent", "different tree", "wrong root", "cycle"])(
    "retains ancestry errors for every affected node: %s",
    (kind) => {
      const doc = chain(4);
      const list = nodes(doc);
      if (kind === "missing parent") list[1].mind!.parentId = "missing";
      if (kind === "different tree") list[1].mind!.treeId = "other";
      if (kind === "wrong root") for (const node of list) node.mind!.treeId = "missing";
      if (kind === "cycle") list[0].mind!.parentId = list[3].id;
      for (const objects of [doc.objects, [...doc.objects].reverse()]) {
        const result = documentSchema.safeParse({ ...doc, objects });
        expect(result.success).toBe(false);
        if (result.success) throw new Error("Expected invalid tree");
        const errors = result.error.issues.map((issue) => issue.message).filter(
          (message) => message === "Повреждённая структура mind map" || message === "Недопустимый корень mind map",
        );
        expect(errors).toEqual(Array(kind === "wrong root" || kind === "cycle" ? 4 : 3).fill(
          kind === "wrong root" ? "Недопустимый корень mind map" : "Повреждённая структура mind map",
        ));
      }
    },
  );

  it("still rejects missing and duplicate structural branches", () => {
    const doc = chain(2);
    const branch = doc.objects.find((o) => o.type === "connector")!;
    for (const objects of [doc.objects.filter((o) => o !== branch), [...doc.objects, { ...branch, id: "duplicate" }]])
      expect(() => parseDocument({ ...doc, objects })).toThrow("Отсутствует или повторяется ветвь mind map");
  });

  it.each(["constructor", "toString", "__proto__"])(
    "rejects prototype property %s as a missing image asset",
    (assetId) => {
      const doc = emptyDocument();
      const image = createObject("image", { x: 0, y: 0 }, doc.background);
      if (image.type !== "image") throw new Error("image");
      doc.objects.push({ ...image, assetId });
      expect(() => parseDocument(doc)).toThrow("Изображение отсутствует");
    },
  );
});
