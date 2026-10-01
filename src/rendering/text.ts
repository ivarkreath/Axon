import { parse, type Font, type Path } from "opentype.js";
import {
  isTextTopic,
  type AxonObject,
  type Bounds,
  type Style,
} from "../model/document";
import { union } from "../model/geometry";

// The budgets count retained key characters and path command scalars, not heap
// bytes. Large one-off strings/outlines bypass the cache instead of evicting it.
function boundedTextCache<T>(maxEntries: number, maxWeight: number) {
  const entries = new Map<string, { value: T; weight: number }>();
  let weight = 0;
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, size: number) {
      if (size > maxWeight) return;
      const previous = entries.get(key);
      if (previous) weight -= previous.weight;
      entries.delete(key);
      entries.set(key, { value, weight: size });
      weight += size;
      while (entries.size > maxEntries || weight > maxWeight) {
        const oldest = entries.keys().next().value!;
        weight -= entries.get(oldest)!.weight;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
      weight = 0;
    },
  };
}
const widths = boundedTextCache<number>(2048, 256000);
const outlines = boundedTextCache<{ path: Path; bounds: Bounds }>(512, 1000000);
type TextBoundsEntry = {
  text: string;
  font: Style["font"];
  fontSize: number;
  align: Style["align"];
  area: Bounds;
  top: boolean;
  bounds: Bounds | null;
};
// Only scalar extents are retained per live immutable object, never glyph paths
// or documents. This avoids full-scene LRU thrashing on repeated Fit/export.
let objectTextBounds = new WeakMap<AxonObject, TextBoundsEntry>();
const fonts: Partial<Record<"sans" | "mono", Font>> = {};
export function registerFonts(sans: ArrayBuffer, mono: ArrayBuffer) {
  fonts.sans = parse(sans);
  fonts.mono = parse(mono);
  widths.clear();
  outlines.clear();
  objectTextBounds = new WeakMap();
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
  const key = `${style.font}|${style.fontSize}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  const width = fontFor(style).getAdvanceWidth(text, style.fontSize, {
    kerning: true,
  });
  widths.set(key, width, key.length);
  return width;
}

function lineOutline(line: TextLine, style: Style) {
  const key = `${style.font}|${style.fontSize}|${line.x}|${line.y}|${line.text}`;
  const cached = outlines.get(key);
  if (cached) return cached;
  const path = fontFor(style).getPath(line.text, line.x, line.y, style.fontSize, { kerning: true });
  const box = path.getBoundingBox();
  const result = {
    path,
    bounds: { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 },
  };
  outlines.set(key, result, key.length + path.commands.length * 7);
  return result;
}

export function textLinePath(line: TextLine, style: Style): string {
  return lineOutline(line, style).path.toPathData(3);
}

/** Exact font contour extents, shared by Fit and export without approximation. */
export function textBounds(
  object: AxonObject & { text: string },
  area: Bounds,
  top = false,
): Bounds | null {
  const cached = objectTextBounds.get(object), style = object.style;
  if (
    cached && cached.text === object.text && cached.font === style.font &&
    cached.fontSize === style.fontSize && cached.align === style.align && cached.top === top &&
    cached.area.x === area.x && cached.area.y === area.y &&
    cached.area.w === area.w && cached.area.h === area.h
  )
    return cached.bounds ? { ...cached.bounds } : null;
  const bounds = union(layoutText(object.text, area, style, top)
    .filter((line) => line.text.trim())
    .map((line) => lineOutline(line, style).bounds)
    .filter((box) => Number.isFinite(box.x)));
  objectTextBounds.set(object, {
    text: object.text,
    font: style.font,
    fontSize: style.fontSize,
    align: style.align,
    area: { ...area },
    top,
    bounds,
  });
  return bounds ? { ...bounds } : null;
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
  const pad = o.type === "text" ? 0 : (o.style.padding ?? 18);
  if (o.type === "shape") {
    if (o.shape === "diamond") {
      fx = 0.5;
      fy = 0.5;
    }
    if (o.shape === "triangle") {
      fx = 0.5;
      fy = 0.45;
      dy = o.h * 0.225;
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
  if (isTextTopic(o)) {
    const pad = o.style.padding ?? 6;
    const natural = Math.max(
      o.style.fontSize,
      ...o.text.split("\n").map((line) => textWidth(line, o.style)),
    );
    const width = Math.max(
      o.style.fontSize,
      Math.min((300 * o.style.fontSize) / 18, natural),
    );
    const lines = wrapText(o.text, width, o.style);
    return {
      ...o,
      w: width + pad * 2,
      h: lines.length * o.style.fontSize * 1.45 + pad * 2,
    };
  }
  if (!("text" in o) || o.type === "connector" || !o.text) return o;
  const widthFactor =
    o.type === "shape" && ["diamond", "triangle"].includes(o.shape)
      ? 0.5
      : o.type === "shape" && o.shape === "ellipse"
        ? 0.7
        : 1;
  const minWidth =
    (Math.max(...Array.from(o.text).map((c) => textWidth(c, o.style)), 20) +
      (o.type === "text" ? 0 : (o.style.padding ?? 18) * 2)) /
    widthFactor;
  const sized = { ...o, w: Math.max(o.w, minWidth) };
  const area = safeArea(sized);
  const lines = wrapText(o.text, area.w, o.style);
  const required = lines.length * o.style.fontSize * 1.45;
  const factor =
    o.type === "shape"
      ? {
          diamond: 0.5,
          triangle: 0.45,
          ellipse: 0.7,
          database: 0.68,
          callout: 0.8,
          rect: 1,
        }[o.shape]
      : 1;
  return {
    ...sized,
    h: Math.max(
      o.h,
      (required + (o.type === "text" ? 0 : (o.style.padding ?? 18) * 2 + 4)) /
        factor,
    ),
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
