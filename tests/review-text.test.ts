import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createObject, emptyDocument, type AxonDocument, type AxonObject } from "../src/model/document";
import { contentBounds, labelArea, linePath, primitives } from "../src/rendering/primitives";
import { fontFor, layoutText, registerFonts } from "../src/rendering/text";
import { union } from "../src/model/geometry";
import { exportBytes, exportScene, makeSVG } from "../src/io/export";

const fontBytes = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}.ttf`)).buffer;
const sans = fontBytes("NotoSans-Regular"), mono = fontBytes("NotoSansMono-Regular");
beforeEach(() => registerFonts(sans, mono));
afterEach(() => vi.restoreAllMocks());

function textDocument(text = "Ёжик, ДРУЖБА и gj\nСтрока с переносом"): AxonDocument {
  const doc = emptyDocument();
  const object = createObject("text", { x: -123.456, y: 12.345 }, doc.background);
  if (object.type !== "text") throw new Error("Expected text");
  object.text = text;
  object.w = 350;
  object.h = 90;
  object.style.fontSize = 28;
  doc.objects.push(object);
  return doc;
}

function exactBounds(object: AxonObject, doc: AxonDocument) {
  if (!("text" in object)) throw new Error("Expected text object");
  return union(layoutText(object.text, labelArea(object, doc), object.style, object.type === "text" || object.type === "sticky")
    .filter((line) => line.text.trim())
    .map((line) => {
      const bounds = fontFor(object.style).getPath(line.text, line.x, line.y, object.style.fontSize, { kerning: true }).getBoundingBox();
      return { x: bounds.x1, y: bounds.y1, w: bounds.x2 - bounds.x1, h: bounds.y2 - bounds.y1 };
    }));
}

describe("exact text geometry reuse", () => {
  it("shares exact outlines between repeated Fit bounds and exports", () => {
    const doc = textDocument();
    const getPath = vi.spyOn(fontFor(doc.objects[0].style), "getPath");
    const first = contentBounds(doc);
    const initialCalls = getPath.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    expect(contentBounds(doc)).toEqual(first);
    primitives(doc.objects[0], doc);
    makeSVG(doc, [], { format: "svg", scope: "all", scale: 1, transparent: true });
    expect(getPath).toHaveBeenCalledTimes(initialCalls);
  });

  it("retains scalar object bounds when a whole scene exceeds the outline cache capacity", () => {
    const doc = textDocument("Узел");
    const prototype = doc.objects[0];
    doc.objects = Array.from({ length: 2000 }, (_, index) => ({
      ...prototype,
      id: `text-${index}`,
      x: index * 10,
      text: `Узел ${index}`,
    }));
    const getPath = vi.spyOn(fontFor(prototype.style), "getPath");
    const first = contentBounds(doc);
    expect(getPath).toHaveBeenCalledTimes(2000);
    expect(contentBounds(doc)).toEqual(first);
    expect(getPath).toHaveBeenCalledTimes(2000);
    // The old path itself was evicted; only its scalar object bounds survived.
    primitives(doc.objects[0], doc);
    expect(getPath).toHaveBeenCalledTimes(2001);
    expect(contentBounds(doc)).toEqual(first);
    expect(getPath).toHaveBeenCalledTimes(2001);
  });

  it.each(["sans", "mono"] as const)("matches original contours for multiline Cyrillic/overhangs with %s", (font) => {
    const doc = textDocument("Ёжик ЙЦУКЕН\nÁj Wgj ЩД\n  \nAV ffi");
    for (const align of ["left", "center", "right"] as const)
      for (const fontSize of [10, 28, 72]) {
        const object = { ...doc.objects[0], style: { ...doc.objects[0].style, font, align, fontSize } };
        const scene = { ...doc, objects: [object] };
        expect(contentBounds(scene)).toEqual(exactBounds(object, scene));
        const paths = primitives(object, scene).filter((primitive) => primitive.type === "path");
        if (!("text" in object)) throw new Error("Expected text");
        const lines = layoutText(object.text, labelArea(object, scene), object.style, true);
        expect(paths.map((primitive) => primitive.d)).toEqual(lines.map((line) =>
          fontFor(object.style).getPath(line.text, line.x, line.y, fontSize, { kerning: true }).toPathData(3),
        ));
      }
  });

  it("invalidates moved/resized/styled text and connector labels when a bound endpoint moves", () => {
    const doc = textDocument();
    contentBounds(doc);
    const object = doc.objects[0];
    for (const patch of [
      { x: object.x + 100, y: object.y - 200 },
      { w: 80 },
      { text: "Новый\nтекст" },
      { style: { ...object.style, fontSize: 48 } },
    ]) {
      const changed = { ...object, ...patch } as AxonObject;
      const next = { ...doc, objects: [changed] };
      expect(contentBounds(next)).toEqual(exactBounds(changed, next));
    }
    const shape = createObject("shape", { x: 0, y: 0 }, doc.background);
    const connector = createObject("connector", { x: 0, y: 0 }, doc.background);
    if (connector.type !== "connector") throw new Error("Expected connector");
    connector.text = "Подпись связи";
    connector.start = { type: "bound", nodeId: shape.id, side: "right" };
    connector.end = { type: "free", x: 300, y: 300 };
    const connected = { ...doc, objects: [shape, connector] };
    const before = primitives(connector, connected);
    contentBounds(connected);
    const moved = { ...connected, objects: [{ ...shape, x: 700 }, connector] };
    expect(primitives(connector, moved)).not.toEqual(before);
    const warmBounds = contentBounds(moved);
    registerFonts(sans, mono);
    expect(contentBounds(moved)).toEqual(warmBounds);
  });

  it("invalidates both object bounds and outlines when registered fonts change", () => {
    const doc = textDocument("iiii WWWW");
    const first = contentBounds(doc);
    registerFonts(mono, sans);
    const changedFont = vi.spyOn(fontFor(doc.objects[0].style), "getPath");
    const second = contentBounds(doc);
    expect(changedFont).toHaveBeenCalled();
    expect(second).not.toEqual(first);
    expect(second).toEqual(exactBounds(doc.objects[0], doc));
  });

  it("keeps SVG/PDF page bounds and font outlines identical across cached exports", async () => {
    const doc = textDocument();
    const options = { format: "svg" as const, scope: "all" as const, scale: 1 as const, transparent: false };
    const scene = exportScene(doc, [], options);
    const svg = makeSVG(doc, [], options);
    expect(makeSVG(doc, [], options)).toBe(svg);
    expect(svg).not.toContain("<text");
    expect(svg).toContain(`viewBox="${scene.bounds.x} ${scene.bounds.y} ${scene.bounds.w} ${scene.bounds.h}"`);
    const pdf = await PDFDocument.load(await exportBytes(doc, [], { ...options, format: "pdf" }));
    expect(pdf.getPage(0).getWidth()).toBe(scene.bounds.w);
    expect(pdf.getPage(0).getHeight()).toBe(scene.bounds.h);
  });
});

describe("retained d3 stroke path contract", () => {
  it("keeps empty, single-point closure and fractional rounding behavior", () => {
    expect(linePath([])).toBe("");
    expect(linePath([{ x: 1.23456, y: -2.34567 }])).toBe("M1.235,-2.346Z");
    expect(linePath([{ x: 0, y: 0 }, { x: 1.23456, y: -2.34567 }])).toBe("M0,0L1.235,-2.346");
  });
});
