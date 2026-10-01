import type { AxonDocument, AxonObject, Bounds, Point } from "./document";
import { objectBounds } from "./geometry";
export type Guide = { axis: "x" | "y"; value: number };
export type SnapTargets = readonly Bounds[];
const boundsCache = new WeakMap<AxonObject, Bounds>();

// Connections are deliberately excluded, as in the original snapping rules.
// Remaining bounds depend only on their immutable object, never attached nodes.
export function prepareSnap(
  doc: AxonDocument,
  excluded: readonly string[],
): SnapTargets {
  const excludedIds = new Set(excluded);
  return doc.objects
    .filter((o) => !excludedIds.has(o.id) && o.type !== "connector")
    .map((o) => {
      let bounds = boundsCache.get(o);
      if (!bounds) {
        bounds = objectBounds(o, doc);
        boundsCache.set(o, bounds);
      }
      return bounds;
    });
}
export function snap(
  box: Bounds,
  doc: AxonDocument,
  excluded: string[],
  zoom: number,
  objects: boolean,
  grid: boolean,
  prepared?: SnapTargets,
): { delta: Point; guides: Guide[] } {
  const delta = { x: 0, y: 0 },
    guides: Guide[] = [];
  if (grid) {
    delta.x = Math.round(box.x / 20) * 20 - box.x;
    delta.y = Math.round(box.y / 20) * 20 - box.y;
  }
  const candidates = objects ? (prepared ?? prepareSnap(doc, excluded)) : [];
  if (objects)
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "w" : "h";
      let best = 6 / zoom;
      let found: number | undefined;
      for (const b of candidates) {
        for (const a of [
          box[axis],
          box[axis] + box[size] / 2,
          box[axis] + box[size],
        ])
          for (const target of [
            b[axis],
            b[axis] + b[size] / 2,
            b[axis] + b[size],
          ])
            if (Math.abs(target - a) < best) {
              best = Math.abs(target - a);
              delta[axis] = target - a;
              found = target;
            }
      }
      if (found !== undefined) guides.push({ axis, value: found });
    }
  return { delta, guides };
}
