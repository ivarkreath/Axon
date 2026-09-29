import type {
  AxonDocument,
  AxonObject,
  Bounds,
  Connector,
  Endpoint,
  Point,
} from "./document";
export type Camera = { x: number; y: number; zoom: number };
export const screenToWorld = (p: Point, c: Camera): Point => ({
  x: (p.x - c.x) / c.zoom,
  y: (p.y - c.y) / c.zoom,
});
export const worldToScreen = (p: Point, c: Camera): Point => ({
  x: p.x * c.zoom + c.x,
  y: p.y * c.zoom + c.y,
});
export function zoomAt(c: Camera, p: Point, zoom: number): Camera {
  const z = Math.max(0.1, Math.min(4, zoom));
  const w = screenToWorld(p, c);
  return { x: p.x - w.x * z, y: p.y - w.y * z, zoom: z };
}
export function rect(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
export function union(boxes: Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}
export const intersects = (a: Bounds, b: Bounds) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const sides = ["top", "right", "bottom", "left"] as const;
export function anchor(node: AxonObject, side: (typeof sides)[number]): Point {
  const { x, y, w, h } = node;
  // Cardinal points lie on the actual silhouettes, including the callout's body.
  if (side === "top") return { x: x + w / 2, y };
  if (side === "bottom")
    return {
      x: x + w / 2,
      y: y + (node.type === "shape" && node.shape === "callout" ? h * 0.8 : h),
    };
  return { x: side === "left" ? x : x + w, y: y + h / 2 };
}
export function endpoint(e: Endpoint, doc: AxonDocument): Point {
  if (e.type === "free") return { x: e.x, y: e.y };
  const node = doc.objects.find((o) => o.id === e.nodeId);
  return node ? anchor(node, e.side) : { x: 0, y: 0 };
}
export function route(c: Connector, doc: AxonDocument): Point[] {
  const a = endpoint(c.start, doc),
    b = endpoint(c.end, doc);
  if (c.route === "straight") return [a, b];
  const horizontal = (e: Endpoint) =>
    e.type === "bound"
      ? ["left", "right"].includes(e.side)
      : Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
  const ah = horizontal(c.start),
    bh = horizontal(c.end);
  if (ah && bh)
    return [
      a,
      { x: (a.x + b.x) / 2, y: a.y },
      { x: (a.x + b.x) / 2, y: b.y },
      b,
    ];
  if (!ah && !bh)
    return [
      a,
      { x: a.x, y: (a.y + b.y) / 2 },
      { x: b.x, y: (a.y + b.y) / 2 },
      b,
    ];
  return ah ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}
export function midpoint(points: Point[]): Point {
  const lens = points
    .slice(1)
    .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i++) {
    if (remaining <= lens[i] && lens[i] > 0) {
      const t = remaining / lens[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= lens[i];
  }
  return points[0];
}
export function objectBounds(o: AxonObject, doc: AxonDocument): Bounds {
  if (o.type === "connector") {
    const ps = route(o, doc);
    return union(ps.map((p) => ({ ...p, w: 0, h: 0 })))!;
  }
  if (o.type === "stroke")
    return union(
      o.points.map((p) => ({ x: o.x + p.x, y: o.y + p.y, w: 0, h: 0 })),
    )!;
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
export function fit(box: Bounds | null, width: number, height: number): Camera {
  if (!box) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = Math.min(
    1.5,
    Math.max(
      0.1,
      Math.min(
        (width - 140) / Math.max(1, box.w),
        (height - 140) / Math.max(1, box.h),
      ),
    ),
  );
  return {
    x: width / 2 - (box.x + box.w / 2) * zoom,
    y: height / 2 - (box.y + box.h / 2) * zoom,
    zoom,
  };
}
export function nearestAnchor(
  p: Point,
  doc: AxonDocument,
  zoom: number,
): Endpoint {
  let best: Endpoint = { type: "free", ...p },
    dist = 18 / zoom;
  for (const o of doc.objects)
    if (o.type === "shape" || o.type === "sticky")
      for (const side of sides) {
        const a = anchor(o, side),
          d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d < dist) {
          dist = d;
          best = { type: "bound", nodeId: o.id, side };
        }
      }
  return best;
}
