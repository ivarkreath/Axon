import type { AxonObject, Point } from "../model/document";
import { fitText } from "../rendering/text";
export function resizeObject(
  o: AxonObject,
  handle: string,
  delta: Point,
  shift: boolean,
): AxonObject {
  let { x, y, w, h } = o;
  const right = x + w,
    bottom = y + h;
  if (handle.includes("e")) w = Math.max(24, w + delta.x);
  if (handle.includes("s")) h = Math.max(24, h + delta.y);
  if (handle.includes("w")) {
    w = Math.max(24, w - delta.x);
    x = right - w;
  }
  if (handle.includes("n")) {
    h = Math.max(24, h - delta.y);
    y = bottom - h;
  }
  if (o.type === "image" || shift) {
    const ratio = o.w / o.h;
    if (Math.abs(w - o.w) >= Math.abs(h - o.h) * ratio) h = w / ratio;
    else w = h * ratio;
    if (handle.includes("w")) x = right - w;
    if (handle.includes("n")) y = bottom - h;
  }
  const fitted = fitText({ ...o, x, y, w, h });
  if (handle.includes("w")) fitted.x = right - fitted.w;
  if (handle.includes("n")) fitted.y = bottom - fitted.h;
  return fitted;
}
