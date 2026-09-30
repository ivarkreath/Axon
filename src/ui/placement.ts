import type { Bounds } from "../model/document";
export const DOCK_BOTTOM = 18;
export const DOCK_HEIGHT = 50;
export function visibleSelection(
  box: Bounds,
  viewport: { w: number; h: number },
): Bounds | null {
  const x = Math.max(0, box.x),
    y = Math.max(0, box.y);
  const right = Math.min(viewport.w, box.x + box.w),
    bottom = Math.min(viewport.h, box.y + box.h);
  if (right < x || bottom < y) return null;
  return { x, y, w: right - x, h: bottom - y };
}
export function placeProperties(
  box: Bounds | null,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  avoid = box,
) {
  const margin = 14,
    bottom = viewport.h - DOCK_BOTTOM - DOCK_HEIGHT - 12;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(margin, Math.min(viewport.w - size.w - margin, p.x)),
    y: Math.max(margin, Math.min(bottom - size.h, p.y)),
  });
  if (!box) return clamp({ x: (viewport.w - size.w) / 2, y: bottom - size.h });
  const visible = visibleSelection(box, viewport) ?? box;
  const x = visible.x + (visible.w - size.w) / 2;
  const candidates = [
    { x, y: visible.y - size.h - 22 },
    { x, y: visible.y + visible.h + 22 },
    { x: visible.x + visible.w + 22, y: visible.y },
    { x: visible.x - size.w - 22, y: visible.y },
  ].map(clamp);
  const overlap = (p: { x: number; y: number }) =>
    avoid
      ? Math.max(
          0,
          Math.min(p.x + size.w, avoid.x + avoid.w + 16) -
            Math.max(p.x, avoid.x - 16),
        ) *
        Math.max(
          0,
          Math.min(p.y + size.h, avoid.y + avoid.h + 16) -
            Math.max(p.y, avoid.y - 16),
        )
      : 0;
  return candidates.reduce((best, p) =>
    overlap(p) < overlap(best) ? p : best,
  );
}
