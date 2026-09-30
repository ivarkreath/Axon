import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  emptyDocument,
  parseDocument,
  serializeDocument,
  uid,
  type AxonDocument,
} from "../src/model/document";
import type { TabSession, ViewState } from "../src/shared/contracts";
import { writeDocument } from "./storage";
import { nextUntitledName } from "../src/shared/documentName";
export type FileTab = TabSession & { fingerprint: string | null };
export async function fingerprint(file: string) {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function sameFile(a: string, b: string) {
  const [ra, rb] = await Promise.all([
    realpath(a).catch(() => path.resolve(a)),
    realpath(b).catch(() => path.resolve(b)),
  ]);
  if (
    process.platform === "win32"
      ? ra.toLowerCase() === rb.toLowerCase()
      : ra === rb
  )
    return true;
  const [sa, sb] = await Promise.all([
    stat(a).catch(() => null),
    stat(b).catch(() => null),
  ]);
  return !!sa && !!sb && sa.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
}
export class FileWorkspace {
  tabs = new Map<string, FileTab>();
  activeId = "";
  folder: string | null = null;
  folderFiles: string[] = [];
  get active() {
    return this.get(this.activeId);
  }
  get(id = this.activeId) {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error("Вкладка уже закрыта");
    return tab;
  }
  add(
    document = emptyDocument(),
    file: string | null = null,
    savedContent = serializeDocument(document),
  ): FileTab {
    if (this.tabs.size >= 100)
      throw new Error(
        "Открыто 100 вкладок. Закройте ненужные перед открытием новой.",
      );
    const tab: FileTab = {
      sessionId: uid(),
      untitledName: nextUntitledName(this.tabs.values()),
      document,
      path: file,
      savedContent,
      dirty: serializeDocument(document) !== savedContent,
      recovered: false,
      fingerprint: null,
    };
    this.tabs.set(tab.sessionId, tab);
    this.activeId = tab.sessionId;
    return tab;
  }
  update(id: string, document: AxonDocument, view?: ViewState) {
    const tab = this.get(id);
    tab.document = document;
    tab.dirty = serializeDocument(document) !== tab.savedContent;
    if (view) tab.view = view;
    return tab;
  }
  async open(file: string) {
    for (const tab of this.tabs.values())
      if (tab.path && (await sameFile(tab.path, file))) {
        this.activeId = tab.sessionId;
        return tab;
      }
    const resolved = await realpath(file);
    if ((await stat(resolved)).size > 80e6)
      throw new Error("Файл больше 80 МБ.");
    const bytes = await readFile(resolved);
    const doc = parseDocument(bytes.toString("utf8"));
    const tab = this.add(doc, resolved);
    tab.fingerprint = createHash("sha256").update(bytes).digest("hex");
    return tab;
  }
  async conflict(tab: FileTab, file: string) {
    if (!tab.path || !(await sameFile(tab.path, file))) return false;
    return (await fingerprint(file)) !== tab.fingerprint;
  }
  async save(tab: FileTab, file: string, snapshot: AxonDocument) {
    for (const other of this.tabs.values())
      if (other !== tab && other.path && (await sameFile(other.path, file)))
        throw new Error(
          "Этот файл уже открыт в другой вкладке. Выберите другое имя.",
        );
    const savedContent = await writeDocument(file, snapshot);
    tab.path = await realpath(file);
    tab.savedContent = savedContent;
    tab.fingerprint = createHash("sha256")
      .update(tab.savedContent)
      .digest("hex");
    tab.dirty = serializeDocument(tab.document) !== tab.savedContent;
    tab.recovered = false;
    tab.unavailable = false;
  }
  remove(id: string) {
    this.tabs.delete(id);
    if (this.activeId === id)
      this.activeId = [...this.tabs.keys()].at(-1) ?? "";
    if (!this.tabs.size) this.add();
  }
  snapshot(exclude = new Set<string>()) {
    const tabs = [...this.tabs.values()].filter(
      (t) => !exclude.has(t.sessionId),
    );
    return {
      activeId: tabs.some((t) => t.sessionId === this.activeId)
        ? this.activeId
        : (tabs.at(-1)?.sessionId ?? ""),
      tabs,
    };
  }
  async restore(raw: { activeId?: string; tabs: FileTab[] }) {
    if (new Set(raw.tabs.map((t) => t.sessionId)).size !== raw.tabs.length)
      throw new Error("Повторяющийся ID вкладки");
    const restored: FileTab[] = [];
    for (const entry of raw.tabs) {
      const document = parseDocument(entry.document),
        savedContent = serializeDocument(parseDocument(entry.savedContent));
      const file = typeof entry.path === "string" ? entry.path : null;
      const unavailable = !!file && !(await stat(file).catch(() => null));
      const dirty = serializeDocument(document) !== savedContent;
      restored.push({
        ...entry,
        untitledName:
          typeof entry.untitledName === "string" &&
          /^Без названия(?: [2-9][0-9]*| 1[0-9]+)?$/.test(entry.untitledName) &&
          !restored.some((t) => t.untitledName === entry.untitledName)
            ? entry.untitledName
            : nextUntitledName(restored),
        document,
        savedContent,
        path: file,
        dirty,
        recovered: dirty,
        unavailable,
      });
    }
    this.tabs = new Map(restored.map((t) => [t.sessionId, t]));
    this.activeId =
      raw.activeId && this.tabs.has(raw.activeId)
        ? raw.activeId
        : (restored[0]?.sessionId ?? "");
    if (!this.tabs.size) this.add();
  }
}
