import { documentSchema, type AxonDocument, type Point } from "./document";
import { objectBounds, union } from "./geometry";
import { expandSelection } from "./operations";

/** Uniform transform of an immutable gesture snapshot; attachments remain logical. */
export function scaleSelection(
  doc: AxonDocument,
  ids: string[],
  handle: string,
  delta: Point,
): AxonDocument {
  const selected = new Set(expandSelection(doc, ids));
  const box = union(
    doc.objects
      .filter((o) => selected.has(o.id))
      .map((o) => objectBounds(o, doc)),
  );
  if (!box) return doc;
  for (const o of doc.objects)
    if (
      o.type === "connector" &&
      !o.locked &&
      o.start.type === "bound" &&
      o.end.type === "bound" &&
      selected.has(o.start.nodeId) &&
      selected.has(o.end.nodeId)
    )
      selected.add(o.id);
  const objects = doc.objects.filter((o) => selected.has(o.id));
  if (!objects.length || objects.some((o) => o.locked)) return doc;
  const origin = {
    x: box.x + (handle.includes("w") ? box.w : 0),
    y: box.y + (handle.includes("n") ? box.h : 0),
  };
  const v = {
    x: (handle.includes("w") ? -1 : 1) * box.w,
    y: (handle.includes("n") ? -1 : 1) * box.h,
  };
  const length = v.x * v.x + v.y * v.y;
  if (!length) return doc;
  let minimum = 0.001,
    maximum = 1000;
  const boundCoordinate = (value: number, center: number) => {
    const distance = value - center;
    if (!distance) return;
    const limits = [(-1e6 - center) / distance, (1e6 - center) / distance].sort(
      (a, b) => a - b,
    );
    minimum = Math.max(minimum, limits[0]);
    maximum = Math.min(maximum, limits[1]);
  };
  for (const o of objects) {
    if (o.type === "connector") {
      for (const e of [o.start, o.end])
        if (e.type === "free") {
          boundCoordinate(e.x, origin.x);
          boundCoordinate(e.y, origin.y);
        }
    } else {
      boundCoordinate(o.x, origin.x);
      boundCoordinate(o.y, origin.y);
    }
    if (o.type === "stroke")
      for (const p of o.points) {
        boundCoordinate(p.x, 0);
        boundCoordinate(p.y, 0);
      }
    if (o.type !== "connector" && o.type !== "stroke") {
      minimum = Math.max(minimum, 1 / o.w, 1 / o.h);
      maximum = Math.min(maximum, 100000 / o.w, 100000 / o.h);
    }
    if ("text" in o) {
      minimum = Math.max(minimum, 1 / o.style.fontSize);
      maximum = Math.min(
        maximum,
        1200 / o.style.fontSize,
        10000 / (o.style.padding ?? 18),
      );
    }
    if (o.type === "stroke" && o.style.strokeWidth)
      maximum = Math.min(maximum, 24 / o.style.strokeWidth);
  }
  if (maximum < minimum) return doc;
  const factor = Math.min(
    maximum,
    Math.max(minimum, 1 + (delta.x * v.x + delta.y * v.y) / length),
  );
  if (!Number.isFinite(factor)) return doc;
  const point = (p: Point) => ({
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
  });
  const result = {
    ...doc,
    objects: doc.objects.map((o) => {
      if (!selected.has(o.id)) return o;
      const style = {
        ...o.style,
        ...("text" in o
          ? {
              fontSize: o.style.fontSize * factor,
              padding: (o.style.padding ?? 18) * factor,
            }
          : {}),
      };
      if (o.type === "connector")
        return {
          ...o,
          style,
          start:
            o.start.type === "free"
              ? { ...o.start, ...point(o.start) }
              : o.start,
          end: o.end.type === "free" ? { ...o.end, ...point(o.end) } : o.end,
        };
      if (o.type === "stroke")
        return {
          ...o,
          ...point(o),
          style: { ...style, strokeWidth: style.strokeWidth * factor },
          points: o.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
        };
      return { ...o, ...point(o), w: o.w * factor, h: o.h * factor, style };
    }),
  };
  return documentSchema.safeParse(result).success ? result : doc;
}
