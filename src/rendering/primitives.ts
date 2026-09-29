import { line } from "d3-shape";
import type {
  AxonDocument,
  AxonObject,
  Bounds,
  Point,
} from "../model/document";
import { midpoint, route, union } from "../model/geometry";
import { fontFor, layoutText, safeArea, textWidth } from "./text";
export type PathPrimitive = {
  type: "path";
  d: string;
  fill: string;
  stroke: string;
  width: number;
  dash: boolean;
};
export type ImagePrimitive = {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
};
export type Primitive = PathPrimitive | ImagePrimitive;
export const linePath = (points: Point[]) =>
  line<Point>()
    .x((p) => p.x)
    .y((p) => p.y)(points) ?? "";
const path = (
  d: string,
  fill = "none",
  stroke = "none",
  width = 0,
  dash = false,
): PathPrimitive => ({ type: "path", d, fill, stroke, width, dash });
function rectPath(x: number, y: number, w: number, h: number, r = 0) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`;
}
function ellipsePath(x: number, y: number, w: number, h: number) {
  const k = 0.55228475,
    rx = w / 2,
    ry = h / 2,
    cx = x + rx,
    cy = y + ry;
  return `M${cx + rx} ${cy}C${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry}C${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy}C${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry}C${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy}Z`;
}
export function labelArea(o: AxonObject, doc: AxonDocument): Bounds {
  if (o.type !== "connector") return safeArea(o);
  const p = midpoint(route(o, doc));
  const w =
    Math.max(16, ...o.text.split("\n").map((s) => textWidth(s, o.style))) + 12;
  const h =
    Math.max(1, o.text.split("\n").length) * o.style.fontSize * 1.45 + 8;
  return { x: p.x - w / 2, y: p.y - h / 2, w, h };
}
function arrow(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x),
    a = angle + 0.48,
    b = angle - 0.48;
  return linePath([
    { x: tip.x - size * Math.cos(a), y: tip.y - size * Math.sin(a) },
    tip,
    { x: tip.x - size * Math.cos(b), y: tip.y - size * Math.sin(b) },
  ]);
}
export function primitives(
  o: AxonObject,
  doc: AxonDocument,
  outlineText = true,
): Primitive[] {
  const { x, y, w, h, style: s } = o;
  const out: Primitive[] = [];
  const add = (
    d: string,
    fill = s.fill,
    stroke = s.stroke,
    width = s.strokeWidth,
    dash = s.dash,
  ) => out.push(path(d, fill, stroke, width, dash));
  if (o.type === "shape") {
    if (o.shape === "rect") add(rectPath(x, y, w, h, s.radius));
    if (o.shape === "ellipse") add(ellipsePath(x, y, w, h));
    if (o.shape === "diamond")
      add(
        `M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z`,
      );
    if (o.shape === "callout")
      add(
        `M${x} ${y}H${x + w}V${y + h * 0.8}H${x + w * 0.38}L${x + w * 0.18} ${y + h}V${y + h * 0.8}H${x}Z`,
      );
    if (o.shape === "database") {
      const r = Math.min(20, h * 0.16);
      add(
        `M${x} ${y + r}C${x} ${y - r / 3} ${x + w} ${y - r / 3} ${x + w} ${y + r}V${y + h - r}C${x + w} ${y + h + r / 3} ${x} ${y + h + r / 3} ${x} ${y + h - r}Z`,
      );
      add(
        `M${x} ${y + r}C${x} ${y + r * 2.3} ${x + w} ${y + r * 2.3} ${x + w} ${y + r}`,
        "none",
      );
    }
  }
  if (o.type === "sticky") {
    add(rectPath(x, y, w, h, 3));
    out.push(path(`M${x + 12} ${y + 1}H${x + w - 12}`, "none", "#FFFFFF", 1));
  }
  if (o.type === "stroke")
    add(linePath(o.points.map((p) => ({ x: x + p.x, y: y + p.y }))), "none");
  if (o.type === "image") {
    const a = doc.assets[o.assetId];
    if (a)
      out.push({
        type: "image",
        x,
        y,
        w,
        h,
        href: `data:${a.mime};base64,${a.data}`,
      });
  }
  if (o.type === "connector") {
    const points = route(o, doc).filter(
      (p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y,
    );
    add(linePath(points), "none");
    if (points.length > 1) {
      if (o.arrows !== "none")
        add(
          arrow(
            points.at(-1)!,
            points.at(-2)!,
            Math.max(11, s.strokeWidth * 4),
          ),
          "none",
          s.stroke,
          s.strokeWidth,
          false,
        );
      if (o.arrows === "both")
        add(
          arrow(points[0], points[1], Math.max(11, s.strokeWidth * 4)),
          "none",
          s.stroke,
          s.strokeWidth,
          false,
        );
    }
    if (o.text) {
      const a = labelArea(o, doc);
      out.push(
        path(rectPath(a.x - 3, a.y - 2, a.w + 6, a.h + 4, 5), doc.background),
      );
    }
  }
  if (outlineText && "text" in o && o.text) {
    const area = labelArea(o, doc);
    const lines = layoutText(
      o.text,
      area,
      s,
      o.type === "sticky" || o.type === "text",
    );
    for (const l of lines) {
      const glyphs = fontFor(s).getPath(l.text, l.x, l.y, s.fontSize, {
        kerning: true,
      });
      out.push(path(glyphs.toPathData(3), s.color));
    }
  }
  return out;
}
export function contentBounds(
  doc: AxonDocument,
  objects = doc.objects,
): Bounds | null {
  const boxes: Bounds[] = [];
  // SVG paths share the same geometry with the screen. Text extents are measured from font outlines.
  for (const o of objects) {
    if (o.type === "connector") {
      const points = route(o, doc);
      const b = union(points.map((p) => ({ ...p, w: 0, h: 0 })))!;
      const margin = Math.max(14, o.style.strokeWidth * 5);
      boxes.push({
        x: b.x - margin,
        y: b.y - margin,
        w: b.w + margin * 2,
        h: b.h + margin * 2,
      });
      if (o.text) {
        const a = labelArea(o, doc);
        boxes.push({ x: a.x - 5, y: a.y - 5, w: a.w + 10, h: a.h + 10 });
      }
    } else if (o.type === "stroke") {
      const b = union(
        o.points.map((p) => ({ x: o.x + p.x, y: o.y + p.y, w: 0, h: 0 })),
      )!;
      const margin = o.style.strokeWidth;
      boxes.push({
        x: b.x - margin,
        y: b.y - margin,
        w: b.w + margin * 2,
        h: b.h + margin * 2,
      });
    } else if (o.type !== "text") {
      const m = o.style.strokeWidth / 2;
      boxes.push({ x: o.x - m, y: o.y - m, w: o.w + m * 2, h: o.h + m * 2 });
    }
    if ("text" in o && o.text)
      for (const l of layoutText(
        o.text,
        labelArea(o, doc),
        o.style,
        o.type === "sticky" || o.type === "text",
      )) {
        if (!l.text.trim()) continue;
        const b = fontFor(o.style)
          .getPath(l.text, l.x, l.y, o.style.fontSize)
          .getBoundingBox();
        if (Number.isFinite(b.x1))
          boxes.push({ x: b.x1, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1 });
      }
  }
  return union(boxes);
}
