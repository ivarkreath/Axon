import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createObject,
  documentSchema,
  emptyDocument,
  objectSchema,
  parseDocument,
  serializeDocument,
  serializePreparedDocument,
  validateChangedObjects,
  type AxonDocument,
  type AxonObject,
  type Connector,
} from "../src/model/document";
import { validateMindMap } from "../src/model/mindmapValidation";
import { MAX_DOCUMENT_OBJECTS, MAX_TEXT_LENGTH } from "../src/shared/limits";

function mixedDocument(version: 1 | 2 | 3 = 3): AxonDocument {
  const doc = emptyDocument();
  doc.version = version;
  doc.title = "Совместимость\nрусского текста";
  doc.assets.asset = {
    id: "asset",
    mime: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII=",
    width: 1,
    height: 1,
  };
  for (const [index, type] of (["shape", "sticky", "text", "image", "stroke", "connector"] as const).entries()) {
    const object = createObject(type, { x: index * 100 + 0.12345, y: index ? -index : 0 }, doc.background);
    object.id = type;
    if (object.type === "image") object.assetId = "asset";
    if (object.type === "stroke") object.points = [{ x: 0.1, y: -0.3 }, { x: 4.567, y: 8.901 }];
    if (object.type === "connector") {
      object.start = { type: "bound", nodeId: "shape", side: "right" };
      object.end = { type: "free", x: 10, y: 20 };
      object.startMarker = "circle";
      object.endMarker = "diamond";
    }
    if ("text" in object) object.text = "Строка 1\nСтрока 2";
    doc.objects.push(object);
  }
  const parent = doc.objects[0];
  if (parent.type !== "shape") throw new Error("Expected shape");
  parent.mind = {
    treeId: parent.id,
    parentId: null,
    order: 0,
    ...(version === 3 ? { side: "right" as const, presentation: "text" as const } : {}),
  };
  const child = { ...parent, id: "child", mind: { ...parent.mind, parentId: parent.id } };
  const branch = createObject("connector", { x: 1, y: 2 }, doc.background) as Connector;
  branch.id = "branch";
  branch.mindBranch = child.id;
  branch.start = { type: "bound", nodeId: parent.id, side: "right" };
  branch.end = { type: "bound", nodeId: child.id, side: "left" };
  doc.objects.push(child, branch);
  return doc;
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe("document parsing and prepared serialization", () => {
  it.each([1, 2, 3] as const)("preserves exact canonical JSON and optional fields for version %s", (version) => {
    const input = reverseKeys(mixedDocument(version));
    const parsed = parseDocument(input);
    const canonical = JSON.stringify(parsed);
    expect(serializeDocument(parsed)).toBe(canonical);
    expect(serializePreparedDocument(parsed)).toBe(canonical);
    expect(parseDocument(serializePreparedDocument(parsed))).toEqual(parsed);
    expect(parsed.version).toBe(version);
    expect(parsed.objects[0].style).not.toHaveProperty("padding");
    const branch = parsed.objects.find((object) => object.id === "branch");
    expect(branch).not.toHaveProperty("startMarker");
    expect(branch).not.toHaveProperty("endMarker");
    expect(parsed).not.toBe(input);
    const original = input as AxonDocument;
    expect(parsed.objects[0]).not.toBe(original.objects[0]);
    expect(parsed.objects[0].style).not.toBe(original.objects[0].style);
    expect(parsed.assets.asset).not.toBe(original.assets.asset);
  });

  it("projects known persisted fields only and keeps public serialization strict", () => {
    const doc = mixedDocument();
    const canonical = serializeDocument(doc);
    Object.assign(doc, { selection: ["shape"], tool: "select", cache: {} });
    Object.assign(doc.objects[0], { selected: true });
    Object.assign(doc.objects[0].style, { preview: true });
    const connector = doc.objects.find((object) => object.type === "connector") as Connector;
    Object.assign(connector.start, { screenX: 800 });
    Object.assign(doc.assets.asset, { cachedURL: "blob:preview" });
    expect(() => parseDocument(doc)).toThrow();
    expect(() => serializeDocument(doc)).toThrow();
    expect(serializePreparedDocument(doc)).toBe(canonical);
  });

  it("performs no second schema parse for an accepted snapshot", () => {
    const doc = parseDocument(mixedDocument());
    const parse = vi.spyOn(documentSchema, "safeParse");
    serializePreparedDocument(doc);
    expect(parse).not.toHaveBeenCalled();
    serializeDocument(doc);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("retains JSON's existing negative-zero normalization", () => {
    const doc = mixedDocument();
    doc.objects[0].x = -0;
    expect(Object.is(parseDocument(doc).objects[0].x, -0)).toBe(true);
    const serialized = serializePreparedDocument(doc);
    expect(serialized).toBe(JSON.stringify(parseDocument(doc)));
    expect(Object.is(parseDocument(serialized).objects[0].x, 0)).toBe(true);
  });

  it.each(["version", "missing asset", "duplicate", "cycle", "bound endpoint"])(
    "keeps input and public serialization rejection: %s",
    (damage) => {
      const doc = mixedDocument();
      if (damage === "version") Object.assign(doc, { version: 99 });
      if (damage === "missing asset") doc.assets = {};
      if (damage === "duplicate") doc.objects.push(doc.objects[0]);
      if (damage === "cycle") {
        const root = doc.objects[0];
        if (root.type === "shape") root.mind!.parentId = "child";
      }
      if (damage === "bound endpoint") {
        const connector = doc.objects.find((object) => object.type === "connector") as Connector;
        connector.start = { type: "bound", nodeId: "missing", side: "top" };
      }
      expect(() => parseDocument(doc)).toThrow();
      expect(() => serializeDocument(doc)).toThrow();
    },
  );

  it("reports mind map errors independently and retains offending object identity", () => {
    const doc = mixedDocument();
    expect(validateMindMap(doc)).toEqual([]);
    const child = doc.objects.find((object) => object.id === "child");
    if (child?.type !== "shape") throw new Error("Expected child");
    child.mind!.parentId = "missing";
    const issues = validateMindMap(doc);
    expect(issues).toContainEqual({ object: child, message: "Повреждённая структура mind map" });
    expect(issues.some((issue) => issue.message === "Недопустимая структурная связь")).toBe(true);
  });
});

describe("validation of internal immutable edits", () => {
  it("validates endpoint geometry locally while preserving attachment targets", () => {
    const before = parseDocument(mixedDocument());
    const after = {
      ...before,
      objects: before.objects.map((object) => object.id === "connector" && object.type === "connector"
        ? { ...object, start: { type: "bound" as const, nodeId: "shape", side: "top" as const }, end: { type: "free" as const, x: 80, y: 90 } }
        : object),
    };
    const fullParse = vi.spyOn(documentSchema, "safeParse");
    expect(validateChangedObjects(before, after)).toBe(true);
    expect(fullParse).not.toHaveBeenCalled();
    const invalid = {
      ...after,
      objects: after.objects.map((object) => object.id === "connector" && object.type === "connector"
        ? { ...object, end: { type: "free" as const, x: Infinity, y: 90 } }
        : object),
    };
    expect(validateChangedObjects(after, invalid)).toBe(false);
    expect(fullParse).not.toHaveBeenCalled();
  });

  it("checks only changed objects and never reads assets for text/style/geometry edits", () => {
    const before = parseDocument(mixedDocument());
    const data = before.assets.asset.data;
    const readAsset = vi.fn(() => data);
    Object.defineProperty(before.assets.asset, "data", { enumerable: true, get: readAsset });
    const after = {
      ...before,
      objects: before.objects.map((object) => object.id === "text"
        ? { ...object, x: object.x + 1, text: "Новый текст", style: { ...object.style, color: "#123456" } }
        : object),
    };
    const parseDocumentSpy = vi.spyOn(documentSchema, "safeParse");
    const parseObjectSpy = vi.spyOn(objectSchema, "safeParse");
    expect(validateChangedObjects(before, after)).toBe(true);
    expect(parseObjectSpy).toHaveBeenCalledTimes(1);
    expect(parseDocumentSpy).not.toHaveBeenCalled();
    expect(readAsset).not.toHaveBeenCalled();
    expect(validateChangedObjects(after, after)).toBe(true);
    expect(parseObjectSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { text: "x".repeat(MAX_TEXT_LENGTH + 1) },
    { w: 100001 },
    { x: Infinity },
    { x: 1000001 },
    { style: { fontSize: 0 } },
  ])("retains runtime text/style/geometry bounds for changed objects", (patch) => {
    const before = parseDocument(mixedDocument());
    const after = {
      ...before,
      objects: before.objects.map((object) => object.id === "text" ? { ...object, ...patch } as AxonObject : object),
    };
    expect(validateChangedObjects(before, after)).toBe(false);
  });

  it.each(["addition", "endpoint", "mind", "asset", "group lock", "metadata"])(
    "retains full structural validation when %s changes",
    (change) => {
      const before = parseDocument(mixedDocument());
      const after = { ...before, objects: [...before.objects] };
      if (change === "addition") after.objects.push(after.objects[0]);
      if (change === "endpoint")
        after.objects = after.objects.map((object) => object.type === "connector"
          ? { ...object, end: { type: "bound", nodeId: "missing", side: "left" } }
          : object);
      if (change === "mind")
        after.objects = after.objects.map((object) => object.id === "shape" && object.type === "shape"
          ? { ...object, mind: { ...object.mind!, parentId: "child" } }
          : object);
      if (change === "asset") after.assets = {};
      if (change === "group lock")
        after.objects = after.objects.map((object, index) => index < 2 ? { ...object, groupId: "group", locked: index === 1 } : object);
      if (change === "metadata") after.title = "";
      const parse = vi.spyOn(documentSchema, "safeParse");
      expect(validateChangedObjects(before, after)).toBe(false);
      expect(parse).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the object count limit for additions", () => {
    const before = emptyDocument();
    const object = createObject("text", { x: 0, y: 0 }, before.background);
    const after = {
      ...before,
      objects: Array.from({ length: MAX_DOCUMENT_OBJECTS + 1 }, (_, index) => ({ ...object, id: String(index) })),
    };
    expect(validateChangedObjects(before, after)).toBe(false);
  });
});
