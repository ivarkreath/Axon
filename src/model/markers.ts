import type { Bounds, Marker, Point } from "./document";
export type MarkerGeometry = {
  d: string;
  filled: boolean;
  width: number;
  inset: number;
  bounds: Bounds;
};
/** Local +x points toward the endpoint. The endpoint stays at the outer tip. */
export function markerGeometry(
  kind: Marker,
  tip: Point,
  from: Point,
  length: number,
  lineWidth: number,
): MarkerGeometry | null {
  if (kind === "none" || length <= 0) return null;
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x),
    dx = Math.cos(angle),
    dy = Math.sin(angle);
  const point = (x: number, y: number): Point => ({
    x: tip.x + x * dx - y * dy,
    y: tip.y + x * dy + y * dx,
  });
  const p = (x: number, y: number) => {
    const q = point(x, y);
    return `${q.x},${q.y}`;
  };
  const half = length * 0.375;
  let vertices = [tip, point(-length, half), point(-length, -half)];
  let d = `M${p(0, 0)}L${p(-length, half)}L${p(-length, -half)}Z`;
  if (kind === "open")
    d = `M${p(-length, half)}L${p(0, 0)}L${p(-length, -half)}`;
  if (kind === "diamond") {
    vertices = [
      tip,
      point(-length / 2, half),
      point(-length, 0),
      point(-length / 2, -half),
    ];
    d = `M${p(0, 0)}L${p(-length / 2, half)}L${p(-length, 0)}L${p(-length / 2, -half)}Z`;
  }
  if (kind === "circle") {
    const r = length / 2,
      k = r * 0.5522847498;
    d = `M${p(0, 0)}C${p(0, k)} ${p(-r + k, r)} ${p(-r, r)}C${p(-r - k, r)} ${p(-length, k)} ${p(-length, 0)}C${p(-length, -k)} ${p(-r - k, -r)} ${p(-r, -r)}C${p(-r + k, -r)} ${p(0, -k)} ${p(0, 0)}Z`;
    const center = point(-r, 0);
    vertices = [
      { x: center.x - r, y: center.y - r },
      { x: center.x + r, y: center.y + r },
    ];
  }
  const width = kind === "arrow" ? 0 : Math.min(lineWidth, length / 4);
  const x = Math.min(...vertices.map((p) => p.x)) - width / 2,
    y = Math.min(...vertices.map((p) => p.y)) - width / 2;
  return {
    d,
    filled: kind === "arrow",
    width,
    inset: kind === "open" ? 0 : Math.max(0, length - lineWidth / 2),
    bounds: {
      x,
      y,
      w: Math.max(...vertices.map((p) => p.x)) + width / 2 - x,
      h: Math.max(...vertices.map((p) => p.y)) + width / 2 - y,
    },
  };
}
