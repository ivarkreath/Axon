import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  registerFonts,
  fitText,
  safeArea,
  wrapText,
} from "../src/rendering/text";
import {
  createObject,
  emptyDocument,
  parseDocument,
  serializeDocument,
  type Asset,
  type Connector,
} from "../src/model/document";
import {
  anchor,
  endpoint,
  fit,
  midpoint,
  route,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "../src/model/geometry";
import {
  copySubset,
  deleteObjects,
  expandSelection,
  groupObjects,
  lockObjects,
  moveObjects,
  pasteObjects,
  alignObjects,
  reorder,
} from "../src/model/operations";
import { History } from "../src/model/history";
import { snap } from "../src/model/snapping";
import { resizeObject } from "../src/editor/resize";
import { exportBytes, exportScene, makeSVG } from "../src/io/export";
import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { fixture } from "./fixture";
beforeAll(() => {
  const font = (name: string) =>
    new Uint8Array(readFileSync(`public/fonts/${name}.ttf`)).buffer;
  registerFonts(font("NotoSans-Regular"), font("NotoSansMono-Regular"));
});
describe("coordinates and routing", () => {
  it("roundtrips canvas coordinates and keeps the cursor point fixed while zooming", () => {
    const c = { x: -120, y: 250, zoom: 0.35 },
      p = { x: 531, y: -240 };
    expect(screenToWorld(worldToScreen(p, c), c).x).toBeCloseTo(p.x);
    expect(screenToWorld(worldToScreen(p, c), c).y).toBeCloseTo(p.y);
    const cursor = { x: 313, y: 422 };
    const next = zoomAt(c, cursor, 1.8);
    const a = screenToWorld(cursor, c),
      b = screenToWorld(cursor, next);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
  });
  it("follows moved and resized nodes without modifying logical attachment", () => {
    const d = fixture();
    const c = d.objects.find((o) => o.id === "api") as Connector;
    const moved = moveObjects(d, ["client"], { x: 51, y: -12 });
    expect(endpoint(c.start, moved)).toEqual({ x: 246, y: 40 });
    const resized = {
      ...moved,
      objects: moved.objects.map((o) =>
        o.id === "client" ? { ...o, w: 320, h: 160 } : o,
      ),
    };
    expect(endpoint(c.start, resized)).toEqual({ x: 371, y: 68 });
    expect(c.start).toEqual({ type: "bound", nodeId: "client", side: "right" });
  });
  it("keeps orthogonal segments and labels on the route", () => {
    const d = fixture();
    for (const c of d.objects.filter((o) => o.type === "connector")) {
      const points = route(c, d);
      for (let i = 1; i < points.length; i++)
        expect(
          points[i].x === points[i - 1].x || points[i].y === points[i - 1].y,
        ).toBe(true);
      expect(Number.isFinite(midpoint(points).x)).toBe(true);
    }
  });
  it("places callout attachment on its body and handles an empty fit", () => {
    const o = createObject("shape", { x: 0, y: 0 }, "#181C22", "callout");
    expect(anchor(o, "bottom").y).toBe(80);
    expect(fit(null, 1000, 700)).toEqual({ x: 500, y: 350, zoom: 1 });
  });
  it("uses screen-sized snapping threshold at different zooms", () => {
    const d = emptyDocument();
    d.objects = [createObject("shape", { x: 100, y: 0 }, d.background)];
    expect(
      snap({ x: 89, y: 300, w: 1, h: 1 }, d, [], 0.5, true, false).guides
        .length,
    ).toBeGreaterThan(0);
    expect(
      snap({ x: 89, y: 300, w: 1, h: 1 }, d, [], 2, true, false).guides.length,
    ).toBe(0);
  });
});
describe("document operations and history", () => {
  it("deletes all incident connectors in one undoable operation even if connector locked", () => {
    const d = fixture();
    const c = d.objects.find((o) => o.id === "api")!;
    c.locked = true;
    const h = new History();
    const next = deleteObjects(d, ["gateway"]);
    h.commit(d, next);
    expect(
      next.objects.some((o) => ["gateway", "api", "validation"].includes(o.id)),
    ).toBe(false);
    expect(h.undo(next)).toEqual(d);
    expect(h.redo(d)).toEqual(next);
  });
  it("respects locked nodes for direct multi-delete", () => {
    const d = lockObjects(fixture(), ["client"], true);
    const next = deleteObjects(d, ["client", "gateway"]);
    expect(next.objects.some((o) => o.id === "client")).toBe(true);
    expect(next.objects.some((o) => o.id === "gateway")).toBe(false);
  });
  it("gives copies new independent IDs, remaps internal connectors and detaches external ends", () => {
    const d = fixture();
    const source = copySubset(d, ["client", "gateway", "validation"]);
    const { doc, ids } = pasteObjects(d, source);
    expect(ids.every((id) => !d.objects.some((o) => o.id === id))).toBe(true);
    const copied = doc.objects.filter((o) => ids.includes(o.id));
    const internal = copied.find(
      (o) => o.type === "connector" && o.text === "HTTPS",
    ) as Connector;
    expect(
      internal.start.type === "bound" && ids.includes(internal.start.nodeId),
    ).toBe(true);
    const external = copied.find(
      (o) => o.type === "connector" && o.text === "Проверка",
    ) as Connector;
    expect(external.end.type).toBe("free");
    const moved = moveObjects(doc, ids, { x: 77, y: 55 });
    expect(moved.objects.find((o) => o.id === "client")).toEqual(
      d.objects.find((o) => o.id === "client"),
    );
  });
  it("selects flat groups, prevents nested groups and duplicates internal links", () => {
    let d = fixture();
    d = groupObjects(d, ["client", "gateway", "api"]);
    const selected = expandSelection(d, ["client"]);
    expect(selected).toHaveLength(3);
    d = groupObjects(d, [...selected, "decision"]);
    expect(
      new Set(d.objects.filter((o) => o.groupId).map((o) => o.groupId)).size,
    ).toBe(1);
    const pasted = pasteObjects(d, copySubset(d, ["client"]));
    const originalGroup = d.objects.find((o) => o.id === "client")!.groupId;
    expect(
      pasted.doc.objects
        .filter((o) => pasted.ids.includes(o.id))
        .every((o) => o.groupId !== originalGroup),
    ).toBe(true);
  });
  it("preserves group geometry during alignment", () => {
    let d = fixture();
    d = groupObjects(d, ["client", "gateway"]);
    const result = alignObjects(d, ["client", "database"], "left");
    expect(
      result.objects.find((o) => o.id === "gateway")!.x -
        result.objects.find((o) => o.id === "client")!.x,
    ).toBe(280);
    expect(result.objects.find((o) => o.id === "database")!.x).toBe(0);
  });
  it("changes stacking in one step and supports distribution", () => {
    const d = fixture();
    expect(reorder(d, ["client"], "front").objects.at(-1)!.id).toBe("client");
    const a = alignObjects(d, ["client", "gateway", "service"], "distributeX");
    const objs = ["client", "gateway", "service"].map((id) =>
      a.objects.find((o) => o.id === id)!,
    );
    expect(objs[1].x - objs[0].x - objs[0].w).toBeCloseTo(
      objs[2].x - objs[1].x - objs[1].w,
    );
  });
  it("coalesces a drag as one history transaction", () => {
    const d = fixture(),
      h = new History();
    let next = d;
    for (let i = 0; i < 100; i++)
      next = moveObjects(d, ["client"], { x: i, y: 0 });
    h.commit(d, next);
    expect(h.undo(next)).toEqual(d);
    expect(h.canUndo).toBe(false);
  });
});
describe("format, images and text", () => {
  const asset: Asset = {
    id: "asset",
    mime: "image/png",
    width: 1,
    height: 1,
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII=",
  };
  it("roundtrips standalone embedded images, groups and styles", () => {
    const d = groupObjects(fixture(asset), ["client", "gateway"]);
    const restored = parseDocument(serializeDocument(d));
    expect(restored).toEqual(d);
    expect(restored.assets.asset.data).toBe(asset.data);
  });
  it("rejects unsupported versions, duplicate IDs, remote assets and dangling references", () => {
    const d = fixture();
    expect(() => parseDocument({ ...d, version: 99 })).toThrow(/версия/);
    expect(() =>
      parseDocument({ ...d, objects: [...d.objects, d.objects[0]] }),
    ).toThrow();
    expect(() =>
      parseDocument({
        ...d,
        objects: d.objects.filter((o) => o.id !== "client"),
      }),
    ).toThrow();
    expect(() =>
      parseDocument({
        ...d,
        assets: { asset: { ...asset, data: "https://example.com/a.png" } },
      }),
    ).toThrow();
  });
  it("grows diamond text and clamps resize without shrinking font", () => {
    const o = createObject("shape", { x: 0, y: 0 }, "#181C22", "diamond");
    if (o.type !== "shape") throw Error();
    o.text = "Проверка кириллицы\nУсловие перехода\nДлинная третья строка";
    const next = fitText(o);
    const small = resizeObject(next, "se", { x: -500, y: -500 }, false);
    const area = safeArea(small);
    expect(area.h).toBeGreaterThanOrEqual(
      wrapText("text" in small ? small.text : "", area.w, small.style).length *
        small.style.fontSize *
        1.45,
    );
    expect(small.style.fontSize).toBe(o.style.fontSize);
  });
  it("preserves image aspect ratio during corner resize", () => {
    const o = createObject("image", { x: 0, y: 0 }, "#181C22");
    const next = resizeObject(
      { ...o, w: 400, h: 200 },
      "se",
      { x: 100, y: 0 },
      false,
    );
    expect(next.w / next.h).toBe(2);
  });
});
describe("export invariants", () => {
  const options = {
    format: "svg" as const,
    scope: "all" as const,
    scale: 1 as const,
    transparent: false,
  };
  it("exports vector paths for Cyrillic without remote fonts, UI or viewport", () => {
    const d = fixture();
    const svg = makeSVG(d, [], options);
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    expect(svg).not.toContain("selection");
    expect(svg).not.toContain("grid");
    expect(svg).toEqual(
      makeSVG(parseDocument(serializeDocument(d)), [], options),
    );
  });
  it("exports exact selection without adding neighbour nodes", () => {
    const d = fixture();
    const result = exportScene(d, ["client"], {
      ...options,
      scope: "selection",
    });
    expect(result.bounds.w).toBeLessThan(300);
    expect(
      makeSVG(d, ["client"], {
        ...options,
        scope: "selection",
        transparent: true,
      }),
    ).not.toContain("<rect");
  });
  it("does not include the origin for empty lines in selected text", () => {
    const d = fixture();
    const result = exportScene(d, ["note"], { ...options, scope: "selection" });
    expect(result.bounds.w).toBe(294);
    expect(result.bounds.h).toBe(254);
  });
  it("rejects empty and excessive export bounds", () => {
    expect(() => makeSVG(emptyDocument(), [], options)).toThrow(/нечего/);
    const d = fixture();
    d.objects.find((o) => o.id === "client")!.x = 999999;
    expect(() => makeSVG(d, [], options)).toThrow(/большой/);
  });
  it("creates a single-page PDF with correct content dimensions", async () => {
    const d = fixture();
    const bytes = await exportBytes(d, [], { ...options, format: "pdf" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBe(
      exportScene(d, [], options).bounds.w,
    );
  });
  it("shares embedded image data between repeated PDF drawings and isolates exports", async () => {
    const doc = emptyDocument();
    const image = createObject("image", { x: 0, y: 0 }, doc.background);
    if (image.type !== "image") throw new Error("image");
    image.assetId = "asset";
    doc.assets.asset = {
      id: "asset", mime: "image/png", width: 1, height: 1,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ3sAAAAASUVORK5CYII=",
    };
    doc.objects = [image, { ...image, id: "copy", x: 300 }];
    for (let i = 0; i < 2; i++) {
      const bytes = await exportBytes(doc, [], { ...options, format: "pdf" });
      const pdf = await PDFDocument.load(bytes);
      const xObjects = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
      const references = xObjects.values();
      expect(references).toHaveLength(2);
      expect(references.every((value) => value instanceof PDFRef)).toBe(true);
      expect(new Set(references.map((value) => value.toString())).size).toBe(1);
    }
  });
});
