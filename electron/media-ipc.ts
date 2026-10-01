import {
  clipboard,
  ClipboardItem,
  dialog,
  nativeImage,
  type BrowserWindow,
} from "electron";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import {
  parseDocument,
  serializePreparedDocument,
  type Asset,
} from "../src/model/document";
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_TEXT_LENGTH,
} from "../src/shared/limits";
import { atomicWrite } from "./storage";
import type { RegisterHandler } from "./ipc";

function bytesOf(value: unknown, max = MAX_DOCUMENT_BYTES): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength > max ||
    !value.byteLength
  )
    throw new Error("Недопустимый размер данных");
  return Buffer.from(value);
}
function imageAsset(value: unknown, mime?: unknown): Asset {
  const bytes = bytesOf(value, MAX_IMAGE_BYTES);
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    (!png && !jpeg) ||
    (mime && !["image/png", "image/jpeg"].includes(String(mime)))
  )
    throw new Error("Поддерживаются только PNG и JPEG.");
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error("Не удалось прочитать изображение.");
  const { width, height } = image.getSize();
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new Error("Изображение слишком большое (не более 40 мегапикселей).");
  const normalized = image.toPNG();
  if (normalized.length > MAX_IMAGE_BYTES)
    throw new Error("Изображение после декодирования больше 20 МБ.");
  return {
    id: crypto.randomUUID(),
    mime: "image/png",
    data: normalized.toString("base64"),
    width,
    height,
  };
}
export function registerMediaHandlers(
  handle: RegisterHandler,
  win: BrowserWindow,
) {
  handle("axon:import-image", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Вставить изображение",
      properties: ["openFile"],
      filters: [{ name: "PNG / JPEG", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > MAX_IMAGE_BYTES)
      throw new Error("Изображение больше 20 МБ.");
    return imageAsset(await readFile(result.filePaths[0]));
  });
  handle("axon:decode-image", (bytes, mime) => imageAsset(bytes, mime));
  handle("axon:clipboard-read", async () => {
    const text = await clipboard.readText();
    if (text.startsWith("AXON_CLIPBOARD\n"))
      try {
        return { document: parseDocument(text.slice(15)) };
      } catch {
        /* treat malformed own format as plain text */
      }
    for (const item of await clipboard.read())
      for (const mime of ["image/png", "image/jpeg"])
        if (item.types.includes(mime)) {
          const blob = (await item.getType(mime)) as Blob;
          return {
            image: imageAsset(new Uint8Array(await blob.arrayBuffer())),
          };
        }
    return { text: text.slice(0, MAX_TEXT_LENGTH) };
  });
  handle("axon:clipboard-write", (raw) =>
    clipboard.writeText(
      "AXON_CLIPBOARD\n" + serializePreparedDocument(parseDocument(raw)),
    ),
  );
  handle("axon:clipboard-png", async (raw) => {
    const asset = imageAsset(raw);
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob(
          [new Uint8Array(Buffer.from(asset.data, "base64"))],
          { type: "image/png" },
        ),
      }),
    ]);
  });
  handle("axon:export", async (format, raw, title) => {
    const ext = z.enum(["png", "svg", "pdf"]).parse(format);
    const bytes = bytesOf(raw);
    const name = z
      .string()
      .max(200)
      .parse(title)
      .replace(/[<>:"/\\|?*]/g, "_");
    const result = await dialog.showSaveDialog(win, {
      title: "Экспорт схемы",
      defaultPath: `${name}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return false;
    const target = result.filePath.toLowerCase().endsWith("." + ext)
      ? result.filePath
      : result.filePath + "." + ext;
    await atomicWrite(target, bytes);
    return true;
  });
}
