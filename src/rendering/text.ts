import { parse, type Font } from "opentype.js";
import type { AxonObject, Bounds, Style } from "../model/document";
const fonts: Partial<Record<"sans" | "mono", Font>> = {};
export function registerFonts(sans: ArrayBuffer, mono: ArrayBuffer) {
  fonts.sans = parse(sans);
  fonts.mono = parse(mono);
}
export async function loadFonts() {
  const [sans, mono] = await Promise.all(
    ["NotoSans-Regular.ttf", "NotoSansMono-Regular.ttf"].map(async (name) => {
      const r = await fetch(new URL(`fonts/${name}`, document.baseURI));
      return r.arrayBuffer();
    }),
  );
  registerFonts(sans, mono);
  await document.fonts.ready;
}
export function fontFor(style: Style) {
  const font = fonts[style.font];
  if (!font) throw new Error("Шрифты ещё не загружены");
  return font;
}
export function textWidth(text: string, style: Style) {
  return fontFor(style).getAdvanceWidth(text, style.fontSize, {
    kerning: true,
  });
}
export function wrapText(text: string, width: number, style: Style): string[] {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (textWidth(line + word, style) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) {
        result.push(line.trimEnd());
        line = "";
      }
      if (!word.trim()) continue;
      for (const char of Array.from(word)) {
        if (line && textWidth(line + char, style) > width) {
          result.push(line);
          line = "";
        }
        line += char;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}
export function safeArea(o: AxonObject): Bounds {
  let fx = 1,
    fy = 1,
    dy = 0;
  const pad = o.type === "text" ? 0 : 18;
  if (o.type === "shape") {
    if (o.shape === "diamond") {
      fx = 0.5;
      fy = 0.5;
    }
    if (o.shape === "ellipse") {
      fx = 0.7;
      fy = 0.7;
    }
    if (o.shape === "database") {
      fy = 0.68;
      dy = 4;
    }
    if (o.shape === "callout") {
      fy = 0.8;
      dy = -o.h * 0.1;
    }
  }
  return {
    x: o.x + (o.w * (1 - fx)) / 2 + pad,
    y: o.y + (o.h * (1 - fy)) / 2 + pad + dy,
    w: Math.max(1, o.w * fx - pad * 2),
    h: Math.max(1, o.h * fy - pad * 2),
  };
}
export function fitText<T extends AxonObject>(o: T): T {
  if (!("text" in o) || o.type === "connector" || !o.text) return o;
  const widthFactor =
    o.type === "shape" && o.shape === "diamond"
      ? 0.5
      : o.type === "shape" && o.shape === "ellipse"
        ? 0.7
        : 1;
  const minWidth =
    (Math.max(...Array.from(o.text).map((c) => textWidth(c, o.style)), 20) +
      (o.type === "text" ? 0 : 36)) /
    widthFactor;
  const sized = { ...o, w: Math.max(o.w, minWidth) };
  const area = safeArea(sized);
  const lines = wrapText(o.text, area.w, o.style);
  const required = lines.length * o.style.fontSize * 1.45;
  const factor =
    o.type === "shape"
      ? { diamond: 0.5, ellipse: 0.7, database: 0.68, callout: 0.8, rect: 1 }[
          o.shape
        ]
      : 1;
  return {
    ...sized,
    h: Math.max(o.h, (required + (o.type === "text" ? 0 : 40)) / factor),
  };
}
export type TextLine = { text: string; x: number; y: number };
export function layoutText(
  text: string,
  area: Bounds,
  style: Style,
  top = false,
): TextLine[] {
  const lines = wrapText(text, area.w, style);
  const lineHeight = style.fontSize * 1.45;
  const font = fontFor(style);
  const asc = (font.ascender / font.unitsPerEm) * style.fontSize;
  const desc = (-font.descender / font.unitsPerEm) * style.fontSize;
  const height = lines.length * lineHeight;
  const y =
    area.y +
    (top ? 0 : (area.h - height) / 2) +
    (lineHeight - asc - desc) / 2 +
    asc;
  return lines.map((text, i) => ({
    text,
    x:
      area.x +
      (style.align === "center"
        ? (area.w - textWidth(text, style)) / 2
        : style.align === "right"
          ? area.w - textWidth(text, style)
          : 0),
    y: y + i * lineHeight,
  }));
}
