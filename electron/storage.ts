import { mkdir, open, rename, rm, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseDocument,
  serializePreparedDocument,
  type AxonDocument,
} from "../src/model/document";
import { MAX_DOCUMENT_BYTES } from "../src/shared/limits";
export async function atomicWrite(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}
export async function readDocument(file: string): Promise<AxonDocument> {
  if ((await stat(file)).size > MAX_DOCUMENT_BYTES) throw new Error("Файл больше 80 МБ.");
  return parseDocument(await readFile(file, "utf8"));
}
export async function writeDocument(file: string, doc: AxonDocument) {
  return writePreparedDocument(file, parseDocument(doc));
}
/** Internal persistence of snapshots already accepted by the document boundary. */
export async function writePreparedDocument(file: string, doc: AxonDocument) {
  const data = serializePreparedDocument(doc);
  if (Buffer.byteLength(data, "utf8") > MAX_DOCUMENT_BYTES)
    throw new Error(
      "Документ больше 80 МБ. Уменьшите количество изображений или содержимого перед сохранением.",
    );
  await atomicWrite(file, data);
  return data;
}
