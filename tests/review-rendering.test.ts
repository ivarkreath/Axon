import { describe, expect, it, vi } from "vitest";
import { createObject, emptyDocument, type AxonDocument, type Connector } from "../src/model/document";
import { connectorPath, endpoint, route } from "../src/model/geometry";
import { objectRenderDocument } from "../src/rendering/dependencies";

function scene() {
  const doc = emptyDocument();
  const a = createObject("shape", { x: 10, y: 20 }, doc.background);
  const b = createObject("shape", { x: 400, y: 300 }, doc.background);
  const unrelated = createObject("shape", { x: 800, y: 0 }, doc.background);
  const connector: Connector = { ...createObject("connector", { x: 0, y: 0 }, doc.background) as Connector,
    start: { type: "bound", nodeId: a.id, side: "right" },
    end: { type: "bound", nodeId: b.id, side: "left" }, route: "curved", text: "Связь" };
  doc.objects = [a, b, unrelated, connector];
  return { doc, a, b, unrelated, connector };
}
function replace(doc: AxonDocument, id: string, x: number) {
  return { ...doc, objects: doc.objects.map(o => o.id === id ? { ...o, x } : o) };
}

describe("connector rendering dependencies", () => {
  it("keeps unrelated edits out of connection projections and route generation", () => {
    const { doc, unrelated, connector } = scene();
    const projection = objectRenderDocument(connector, doc);
    const samples = vi.spyOn(Array, "from");
    const points = route(connector, doc);
    const after = replace(doc, unrelated.id, 900);
    expect(objectRenderDocument(connector, after)).toBe(projection);
    expect(route(connector, after)).toBe(points);
    expect(samples.mock.calls.filter(([input]) => "length" in input && input.length === 65)).toHaveLength(1);
    samples.mockRestore();
    expect(projection.objects.some(o => o.id === unrelated.id)).toBe(false);
    expect(projection.assets).toEqual({});
    expect(connectorPath(connector, projection)).toBe(connectorPath(connector, doc));
  });

  it("updates bound geometry on move, resize, deletion and undo without stale paths", () => {
    const { doc, a, b, connector } = scene();
    const projection = objectRenderDocument(connector, doc), before = route(connector, doc);
    const moved = replace(doc, a.id, 100);
    expect(objectRenderDocument(connector, moved)).not.toBe(projection);
    expect(route(connector, moved)).not.toBe(before);
    expect(route(connector, moved)[0]).toEqual(endpoint(connector.start, moved));
    const resized = { ...moved, objects: moved.objects.map(o => o.id === b.id ? { ...o, h: 200 } : o) };
    expect(route(connector, resized).at(-1)).toEqual(endpoint(connector.end, resized));
    const deleted = { ...resized, objects: resized.objects.filter(o => o.id !== b.id) };
    expect(route(connector, deleted).at(-1)).toEqual({ x: 0, y: 0 });
    expect(route(connector, doc)).toEqual(before);
    expect(connectorPath(connector, objectRenderDocument(connector, doc))).toBe(connectorPath(connector, doc));
  });

  it("includes background, own text/style, endpoints and referenced image data", () => {
    const { doc, connector } = scene();
    const projection = objectRenderDocument(connector, doc);
    expect(objectRenderDocument(connector, { ...doc, background: "#FFFFFF" })).not.toBe(projection);
    expect(objectRenderDocument({ ...connector, text: "Новая подпись" }, doc)).not.toBe(projection);
    expect(objectRenderDocument({ ...connector, style: { ...connector.style, strokeWidth: 4 } }, doc)).not.toBe(projection);
    const image = { ...createObject("image", { x: 0, y: 0 }, doc.background), type: "image" as const, assetId: "asset" };
    const asset = { id: "asset", mime: "image/png" as const, data: "AAAA", width: 1, height: 1 };
    const withImage = { ...doc, assets: { asset } };
    const view = objectRenderDocument(image, withImage);
    expect(objectRenderDocument(image, { ...withImage, assets: { asset, other: { ...asset, id: "other" } } })).toBe(view);
    expect(objectRenderDocument(image, { ...withImage, assets: { asset: { ...asset, data: "BBBB" } } })).not.toBe(view);
  });

  it("does not let arrow trimming mutate cached route samples", () => {
    const { doc, connector } = scene();
    for (const kind of ["straight", "orthogonal", "curved"] as const) {
      const c = { ...connector, route: kind }, points = route(c, doc);
      const snapshot = structuredClone(points);
      connectorPath(c, doc, 10, 10);
      expect(route(c, doc)).toBe(points);
      expect(points).toEqual(snapshot);
    }
  });
});
