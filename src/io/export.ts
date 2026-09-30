import { PDFDocument, rgb } from "pdf-lib";
import type { AxonDocument, Bounds } from "../model/document";
import { expandSelection } from "../model/operations";
import {
  contentBounds,
  primitives,
  type Primitive,
} from "../rendering/primitives";
export type ExportOptions = {
  format: "png" | "svg" | "pdf";
  scope: "all" | "selection";
  scale: 1 | 2;
  transparent: boolean;
};
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function svgPrimitive(p: Primitive): string {
  return p.type === "image"
    ? `<image x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" xlink:href="${p.href}"/>`
    : `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="${p.cap ?? "round"}" stroke-linejoin="round"${p.dash ? ' stroke-dasharray="8 6"' : ""}/>`;
}
export function exportScene(
  doc: AxonDocument,
  ids: string[],
  options: ExportOptions,
) {
  const selected = new Set(expandSelection(doc, ids));
  const objects =
    options.scope === "all"
      ? doc.objects
      : doc.objects.filter((o) => selected.has(o.id));
  const b = contentBounds(doc, objects);
  if (!b)
    throw new Error(
      "Пока нечего экспортировать. Добавьте объекты или выберите их.",
    );
  const bounds: Bounds = {
    x: b.x - 32,
    y: b.y - 32,
    w: Math.ceil(b.w + 64),
    h: Math.ceil(b.h + 64),
  };
  if (
    bounds.w > 16384 ||
    bounds.h > 16384 ||
    bounds.w * bounds.h * options.scale ** 2 > 64e6 ||
    bounds.w * options.scale > 16384 ||
    bounds.h * options.scale > 16384
  )
    throw new Error(
      "Результат слишком большой. Выберите меньшую область или масштаб 1×.",
    );
  return { bounds, items: objects.flatMap((o) => primitives(o, doc)) };
}
export function makeSVG(
  doc: AxonDocument,
  ids: string[],
  options: ExportOptions,
): string {
  const { bounds: b, items } = exportScene(doc, ids, options);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><title>${escape(doc.title)}</title>${!options.transparent ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${doc.background}"/>` : ""}${items.map(svgPrimitive).join("")}</svg>`;
}
export async function rasterize(
  svg: string,
  scale: number,
): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Недоступен экспорт PNG");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const result = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Не удалось создать PNG"))),
        "image/png",
      ),
    );
    return new Uint8Array(await result.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
const pdfColor = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
export async function exportBytes(
  doc: AxonDocument,
  ids: string[],
  options: ExportOptions,
): Promise<Uint8Array> {
  if (options.format === "svg")
    return new TextEncoder().encode(makeSVG(doc, ids, options));
  if (options.format === "png")
    return rasterize(makeSVG(doc, ids, options), options.scale);
  const { bounds: b, items } = exportScene(doc, ids, options);
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator("Axon");
  const page = pdf.addPage([b.w, b.h]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: b.w,
    height: b.h,
    color: pdfColor(doc.background),
  });
  for (const p of items) {
    if (p.type === "image") {
      const image = p.href.startsWith("data:image/png")
        ? await pdf.embedPng(p.href)
        : await pdf.embedJpg(p.href);
      page.drawImage(image, {
        x: p.x - b.x,
        y: b.h - (p.y - b.y) - p.h,
        width: p.w,
        height: p.h,
      });
    } else if (p.d) {
      page.drawSvgPath(p.d, {
        x: -b.x,
        y: b.h + b.y,
        color: p.fill === "none" ? undefined : pdfColor(p.fill),
        borderColor:
          p.stroke === "none" || !p.width ? undefined : pdfColor(p.stroke),
        borderWidth: p.width,
        borderDashArray: p.dash ? [8, 6] : undefined,
      });
    }
  }
  return pdf.save();
}
