import type { AxonDocument, Bounds, Point } from "./document";
import { objectBounds } from "./geometry";
export type Guide = { axis: "x" | "y"; value: number };
export function snap(
  box: Bounds,
  doc: AxonDocument,
  excluded: string[],
  zoom: number,
  objects: boolean,
  grid: boolean,
): { delta: Point; guides: Guide[] } {
  const delta = { x: 0, y: 0 },
    guides: Guide[] = [];
  if (grid) {
    delta.x = Math.round(box.x / 20) * 20 - box.x;
    delta.y = Math.round(box.y / 20) * 20 - box.y;
  }
  const excludedIds = new Set(excluded);
  if (objects)
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "w" : "h";
      let best = 6 / zoom;
      let found: number | undefined;
      for (const o of doc.objects)
        if (!excludedIds.has(o.id) && o.type !== "connector") {
          const b = objectBounds(o, doc);
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
