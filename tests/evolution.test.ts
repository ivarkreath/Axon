import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createObject,
  emptyDocument,
  parseDocument,
  serializeDocument,
  type Connector,
} from "../src/model/document";
import { scaleSelection } from "../src/model/transform";
import {
  anchor,
  connectorPath,
  endpoint,
  objectBounds,
  route,
  screenToWorld,
  union,
  worldToScreen,
} from "../src/model/geometry";
import { primitives } from "../src/rendering/primitives";
import { registerFonts, safeArea } from "../src/rendering/text";
import {
  copySubset,
  deleteObjects,
  moveObjects,
  pasteObjects,
} from "../src/model/operations";
import { quickCreate } from "../src/model/quickCreate";
import { addTopic } from "../src/model/mindmap";
import { History } from "../src/model/history";
import { Editor } from "../src/editor/store";
import { exportBytes } from "../src/io/export";
beforeAll(() => {
  const font = (n: string) =>
    new Uint8Array(readFileSync(`public/fonts/${n}.ttf`)).buffer;
  registerFonts(font("NotoSans-Regular"), font("NotoSansMono-Regular"));
});
describe("canvas evolution", () => {
  it("appends sibling order after a deletion and isolates topics from shape defaults", () => {
    const root = addTopic(emptyDocument(), { x: 0, y: 0 })!;
    const first = addTopic(root.doc, root.node, root.node.id)!;
    const second = addTopic(first.doc, root.node, root.node.id)!;
    const third = addTopic(
      deleteObjects(second.doc, [first.node.id]),
      root.node,
      root.node.id,
    )!;
    expect(third.node.mind!.order).toBe(2);
    const e = new Editor();
    e.set({
      prefs: {
        ...e.state.prefs,
        styles: { shape: { ...root.node.style, fill: "#F1D58A" } },
      },
    });
    e.topic(false, true);
    expect(e.state.doc.objects[0].style.fill).toBe("none");
    expect(e.state.doc.objects[0].style.strokeWidth).toBe(0);
  });
  it("keeps the last valid text when large font and long input exceed geometry limits", () => {
    const doc = emptyDocument(),
      node = createObject("shape", { x: 0, y: 0 }, doc.background);
    node.style.fontSize = 1200;
    doc.objects = [node];
    const e = new Editor();
    e.set({ doc });
    e.beginText(node.id);
    e.updateText("строка\n".repeat(100));
    expect(e.state.doc).toBe(doc);
    expect(() => serializeDocument(e.state.doc)).not.toThrow();
    e.updateText("Да");
    e.endText();
    expect(e.history.canUndo).toBe(true);
    e.undo();
    expect(e.state.doc).toEqual(doc);
  });
  it("preserves legacy outline widths and separates selected style from creation defaults", () => {
    const doc = emptyDocument();
    doc.version = 1;
    const a = createObject("shape", { x: 0, y: 0 }, doc.background),
      b = createObject("shape", { x: 300, y: 0 }, doc.background);
    a.style.strokeWidth = 8;
    b.style.strokeWidth = 6;
    doc.objects = [a, b];
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    const e = new Editor();
    e.set({ doc, selection: [a.id, b.id] });
    const preferences = e.state.prefs;
    e.style({ fill: "#F1D58A" });
    expect(e.state.prefs).toBe(preferences);
    expect(e.state.doc.objects.map((o) => o.style.strokeWidth)).toEqual([8, 6]);
    expect(e.newObject("shape", { x: 0, y: 0 }).style.strokeWidth).toBe(1.5);
    e.undo();
    expect(e.state.doc).toEqual(doc);
    expect(e.history.canUndo).toBe(false);
  });
  it("exports triangle, diamond and curved attachments as canonical SVG/PDF", async () => {
    const doc = emptyDocument();
    const a = createObject("shape", { x: 0, y: 0 }, doc.background, "triangle"),
      b = createObject("shape", { x: 400, y: 170 }, doc.background, "diamond");
    if (a.type !== "shape" || b.type !== "shape") throw new Error();
    a.text = "Да";
    b.text = "Нет";
    const c = createObject("connector", a, doc.background) as Connector;
    c.route = "curved";
    c.text = "Связь";
    c.start = { type: "bound", nodeId: a.id, side: "right" };
    c.end = { type: "bound", nodeId: b.id, side: "left" };
    doc.objects = [a, b, c];
    for (const format of ["svg", "pdf"] as const) {
      const result = await exportBytes(doc, [], {
        format,
        scope: "all",
        scale: 1,
        transparent: false,
      });
      expect(result.byteLength).toBeGreaterThan(500);
      if (format === "svg") {
        const svg = new TextDecoder().decode(result);
        expect(svg).not.toContain("data-handle");
        expect(svg).not.toContain("selection");
      }
    }
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  });
  it.each([0.1, 0.25, 0.5, 1, 2, 4])(
    "keeps arrow coordinates, hit targets and viewport visibility at %s zoom",
    (zoom) => {
      const doc = emptyDocument(),
        camera = { x: -137, y: 83, zoom };
      const c = createObject(
        "connector",
        screenToWorld({ x: 250, y: 300 }, camera),
        doc.background,
      ) as Connector;
      c.end = { type: "free", ...screenToWorld({ x: 550, y: 450 }, camera) };
      doc.objects = [c];
      const before = serializeDocument(doc);
      for (const kind of ["straight", "orthogonal", "curved"] as const) {
        const object = { ...c, route: kind };
        expect(worldToScreen(endpoint(object.end, doc), camera)).toEqual({
          x: 550,
          y: 450,
        });
        const canonical = primitives(object, doc, false)[0];
        const viewport = primitives(object, doc, false, zoom)[0];
        if (canonical.type !== "path" || viewport.type !== "path")
          throw new Error("path");
        expect(canonical.width).toBe(2);
        expect(viewport.width * zoom).toBeGreaterThanOrEqual(0.85);
        expect(connectorPath(object, doc).includes("C")).toBe(
          kind === "curved",
        );
        expect(route(object, doc).at(-1)).toEqual(endpoint(object.end, doc));
      }
      expect(serializeDocument(doc)).toBe(before);
    },
  );
  it("scales a mixed selection once, preserves attachments and records one undo", () => {
    const doc = emptyDocument();
    const a = createObject("shape", { x: 0, y: 0 }, doc.background),
      b = createObject("shape", { x: 300, y: 180 }, doc.background);
    a.groupId = b.groupId = "flat";
    const external = createObject("shape", { x: 900, y: 400 }, doc.background);
    const c = createObject(
      "connector",
      { x: 0, y: 0 },
      doc.background,
    ) as Connector;
    c.start = { type: "bound", nodeId: a.id, side: "right" };
    c.end = { type: "bound", nodeId: external.id, side: "left" };
    const stroke = createObject("stroke", { x: 0, y: 400 }, doc.background);
    if (stroke.type !== "stroke") throw new Error();
    stroke.points = [
      { x: 0, y: 0 },
      { x: 100, y: 30 },
    ];
    const image = createObject("image", { x: 700, y: 600 }, doc.background);
    if (image.type !== "image") throw new Error();
    image.assetId = "pixel";
    image.w = 200;
    image.h = 100;
    doc.assets.pixel = {
      id: "pixel",
      mime: "image/png",
      width: 1,
      height: 1,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=",
    };
    doc.objects = [a, b, external, c, stroke, image];
    const ids = [a.id, b.id, c.id, stroke.id, image.id];
    const box = union(
      doc.objects
        .filter((o) => ids.includes(o.id))
        .map((o) => objectBounds(o, doc)),
    )!;
    const next = scaleSelection(doc, ids, "se", { x: box.w, y: box.h });
    expect(next.objects[0].w).toBe(a.w * 2);
    expect(next.objects[1].x).toBe(b.x * 2);
    expect(next.objects[0].style.fontSize).toBe(a.style.fontSize * 2);
    expect(safeArea(next.objects[0]).x).toBe(safeArea(a).x * 2);
    expect(next.objects[2]).toBe(external);
    expect(next.objects[3].style.strokeWidth).toBe(c.style.strokeWidth);
    expect(next.objects[4].style.strokeWidth).toBe(
      stroke.style.strokeWidth * 2,
    );
    expect(next.objects[5].w).toBe(image.w * 2);
    expect(next.objects[5].w / next.objects[5].h).toBe(image.w / image.h);
    expect(next.assets).toBe(doc.assets);
    const smaller = scaleSelection(doc, ids, "se", {
      x: -box.w / 2,
      y: -box.h / 2,
    });
    expect(smaller.objects[0].w).toBe(a.w / 2);
    expect(smaller.objects[4].style.strokeWidth).toBe(
      stroke.style.strokeWidth / 2,
    );
    expect(endpoint(c.start, next).x).toBe(a.w * 2);
    const history = new History();
    history.commit(doc, next);
    expect(history.undo(next)).toEqual(doc);
    expect(history.redo(doc)).toEqual(next);
    expect(parseDocument(serializeDocument(next))).toEqual(next);
    const locked = {
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === stroke.id ? { ...o, locked: true } : o,
      ),
    };
    expect(scaleSelection(locked, ids, "se", { x: 100, y: 50 })).toBe(locked);
  });
  it("quick creates empty styled nodes, avoids collisions and keeps a single transaction", () => {
    const doc = emptyDocument(),
      source = createObject(
        "shape",
        { x: 0, y: 0 },
        doc.background,
        "triangle",
      );
    if (source.type !== "shape") throw new Error();
    source.text = "Исходный текст";
    source.style.strokeWidth = 8;
    source.groupId = "group";
    doc.objects = [source];
    const connection = createObject(
      "connector",
      source,
      doc.background,
    ) as Connector;
    const first = quickCreate(doc, source, "right", connection);
    expect("text" in first.node && first.node.text).toBe("");
    expect(first.node.groupId).toBeUndefined();
    expect(first.node.style.strokeWidth).toBe(1.5);
    const second = quickCreate(first.doc, source, "right", {
      ...connection,
      id: "next-connection",
    });
    expect(second.node.y).not.toBe(first.node.y);
    expect(anchor(source, "right")).toEqual({ x: 135, y: 50 });
    expect(parseDocument(serializeDocument(first.doc))).toEqual(first.doc);
  });
  it("copies, moves, scales and deletes whole mind map branches without double transforms", () => {
    const root = addTopic(emptyDocument(), { x: 0, y: 0 })!;
    const child = addTopic(root.doc, root.node, root.node.id)!;
    const leaf = addTopic(child.doc, child.node, child.node.id)!;
    const before = serializeDocument(leaf.doc);
    const box = union(leaf.doc.objects.map((o) => objectBounds(o, leaf.doc)))!;
    const scaled = scaleSelection(
      leaf.doc,
      [root.node.id, child.node.id],
      "se",
      { x: box.w, y: box.h },
    );
    expect(scaled.objects.find((o) => o.id === leaf.node.id)!.x).toBe(
      leaf.node.x * 2,
    );
    expect(() => parseDocument(scaled)).not.toThrow();
    const moved = moveObjects(leaf.doc, [root.node.id, child.node.id], {
      x: 10,
      y: 20,
    });
    expect(moved.objects.find((o) => o.id === leaf.node.id)!.x).toBe(
      leaf.node.x + 10,
    );
    const copied = copySubset(leaf.doc, [child.node.id]);
    expect(serializeDocument(leaf.doc)).toBe(before);
    expect(() => parseDocument(copied)).not.toThrow();
    const pasted = pasteObjects(leaf.doc, copied);
    expect(() => parseDocument(pasted.doc)).not.toThrow();
    expect(
      pasted.ids.every((id) => !leaf.doc.objects.some((o) => o.id === id)),
    ).toBe(true);
    const deleted = deleteObjects(leaf.doc, [child.node.id]);
    expect(deleted.objects).toHaveLength(1);
    const cyclic = structuredClone(leaf.doc);
    const r = cyclic.objects[0];
    if (r.type === "shape") r.mind!.parentId = leaf.node.id;
    expect(() => parseDocument(cyclic)).toThrow();
  });
});
