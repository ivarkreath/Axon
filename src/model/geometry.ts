import type {
  AxonDocument,
  AxonObject,
  Bounds,
  Connector,
  Endpoint,
  Point,
} from "./document";
import { connectorMarkers } from "./document";
import { markerGeometry } from "./markers";
import { getDocumentIndex } from "./indices";
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
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const box of boxes) {
    x = Math.min(x, box.x);
    y = Math.min(y, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}
export const intersects = (a: Bounds, b: Bounds) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const sides = ["top", "right", "bottom", "left"] as const;
export function anchor(node: AxonObject, side: (typeof sides)[number]): Point {
  const { x, y, w, h } = node;
  if (
    node.type === "shape" &&
    node.shape === "triangle" &&
    (side === "left" || side === "right")
  )
    return { x: x + w * (side === "left" ? 0.25 : 0.75), y: y + h / 2 };
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
  const node = getDocumentIndex(doc).byId.get(e.nodeId);
  return node ? anchor(node, e.side) : { x: 0, y: 0 };
}
const routes = new WeakMap<Connector, { ax: number; ay: number; bx: number; by: number; kind: Connector["route"]; startSide: string; endSide: string; points: Point[] }>();
export function route(c: Connector, doc: AxonDocument): readonly Point[] {
  const a = endpoint(c.start, doc),
    b = endpoint(c.end, doc);
  const cached = routes.get(c);
  const startSide = c.start.type === "bound" ? c.start.side : "free";
  const endSide = c.end.type === "bound" ? c.end.side : "free";
  if (cached && cached.ax === a.x && cached.ay === a.y && cached.bx === b.x && cached.by === b.y &&
    cached.kind === c.route && cached.startSide === startSide && cached.endSide === endSide)
    return cached.points;
  const points = buildRoute(c, doc, a, b);
  routes.set(c, { ax: a.x, ay: a.y, bx: b.x, by: b.y, kind: c.route, startSide, endSide, points });
  return points;
}
function buildRoute(c: Connector, doc: AxonDocument, a: Point, b: Point): Point[] {
  if (c.route === "straight") return [a, b];
  if (c.route === "curved") {
    const [p, q] = curveControls(c, doc);
    return Array.from({ length: 65 }, (_, i) => {
      const t = i / 64,
        u = 1 - t;
      return {
        x:
          u ** 3 * a.x +
          3 * u * u * t * p.x +
          3 * u * t * t * q.x +
          t ** 3 * b.x,
        y:
          u ** 3 * a.y +
          3 * u * u * t * p.y +
          3 * u * t * t * q.y +
          t ** 3 * b.y,
      };
    });
  }
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
export function curveControls(c: Connector, doc: AxonDocument): [Point, Point] {
  const a = endpoint(c.start, doc),
    b = endpoint(c.end, doc);
  const distance = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
  const control = (p: Point, e: Endpoint, direction: number) => {
    const side = e.type === "bound" ? e.side : direction > 0 ? "right" : "left";
    return {
      x: p.x + (side === "right" ? distance : side === "left" ? -distance : 0),
      y: p.y + (side === "bottom" ? distance : side === "top" ? -distance : 0),
    };
  };
  return [
    control(a, c.start, b.x >= a.x ? 1 : -1),
    control(b, c.end, b.x >= a.x ? -1 : 1),
  ];
}
export function connectorPath(
  c: Connector,
  doc: AxonDocument,
  startInset = 0,
  endInset = 0,
): string {
  const ps = route(c, doc);
  const lerp = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const trim = (points: Point[], inset: number) => {
    while (points.length > 1 && inset > 0) {
      const length = Math.hypot(
        points[1].x - points[0].x,
        points[1].y - points[0].y,
      );
      if (length <= inset) {
        points.shift();
        inset -= length;
      } else {
        points[0] = lerp(points[0], points[1], inset / length);
        break;
      }
    }
    return points;
  };
  if (c.route !== "curved") {
    const points = trim(
      trim([...ps], startInset).reverse(),
      endInset,
    ).reverse();
    return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  }
  const [p, q] = curveControls(c, doc),
    a = ps[0],
    b = ps.at(-1)!;
  // Arc-length sampling locates the cut; de Casteljau retains the exact cubic.
  const parameter = (inset: number, reverse = false) => {
    const samples = reverse ? [...ps].reverse() : ps;
    for (let i = 1; i < samples.length; i++) {
      const length = Math.hypot(
        samples[i].x - samples[i - 1].x,
        samples[i].y - samples[i - 1].y,
      );
      if (length > inset) {
        const t = (i - 1 + inset / length) / (samples.length - 1);
        return reverse ? 1 - t : t;
      }
      inset -= length;
    }
    return reverse ? 0 : 1;
  };
  const split = (points: Point[], t: number) => {
    const [a, b, c, d] = points,
      ab = lerp(a, b, t),
      bc = lerp(b, c, t),
      cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t),
      bcd = lerp(bc, cd, t),
      mid = lerp(abc, bcd, t);
    return [
      [a, ab, abc, mid],
      [mid, bcd, cd, d],
    ];
  };
  const endT = endInset ? parameter(endInset, true) : 1;
  const startT = startInset ? parameter(startInset) : 0;
  const cut = split(
    split([a, p, q, b], endT)[0],
    Math.min(1, startT / Math.max(endT, 1e-9)),
  )[1];
  return `M${cut[0].x},${cut[0].y}C${cut[1].x},${cut[1].y} ${cut[2].x},${cut[2].y} ${cut[3].x},${cut[3].y}`;
}
export function midpoint(points: readonly Point[]): Point {
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
    const heads = connectionHeads(o, doc);
    const margin = o.style.strokeWidth / 2;
    return union([
      ...ps.map((p) => ({ x: p.x - margin, y: p.y - margin, w: margin * 2, h: margin * 2 })),
      ...[heads.start, heads.end].flatMap(head => head ? [head.bounds] : []),
    ])!;
  }
  if (o.type === "stroke")
    return union(
      o.points.map((p) => ({ x: o.x + p.x, y: o.y + p.y, w: 0, h: 0 })),
    )!;
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
export function connectionHeads(c: Connector, doc: AxonDocument, zoom?: number) {
  const points = route(c, doc).filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
  const markers = connectorMarkers(c);
  const width = zoom && c.style.strokeWidth > 0 ? Math.max(c.style.strokeWidth, 0.85 / zoom) : c.style.strokeWidth;
  const length = points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
  const size = Math.min(length * (markers.start !== "none" && markers.end !== "none" ? 0.22 : 0.3), Math.max(6 + c.style.strokeWidth, zoom ? 3 / zoom : 0));
  const controls = c.route === "curved" ? curveControls(c, doc) : null;
  const head = (side: "start" | "end") => points.length < 2 || c.style.strokeWidth <= 0 ? null : markerGeometry(markers[side], side === "start" ? points[0] : points.at(-1)!, side === "start" ? controls?.[0] ?? points[1] : controls?.[1] ?? points.at(-2)!, size, width);
  return { start: head("start"), end: head("end"), width };
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
    if (!o.locked && (o.type === "shape" || o.type === "sticky"))
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
