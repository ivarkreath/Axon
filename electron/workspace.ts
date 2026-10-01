import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  emptyDocument,
  parseDocument,
  serializePreparedDocument,
  uid,
  type AxonDocument,
} from "../src/model/document";
import type { TabSession, ViewState } from "../src/shared/contracts";
import { writePreparedDocument } from "./storage";
import { DocumentContentState } from "../src/model/content";
import { MAX_DOCUMENT_BYTES, MAX_TABS } from "../src/shared/limits";
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
async function resolvedFilePath(file: string): Promise<string> {
  const absolute = path.resolve(file);
  try {
    return await realpath(absolute);
  } catch {
    // A deleted file still belongs to its canonical parent (e.g. /var -> /private/var).
    const parent = path.dirname(absolute);
    return parent === absolute
      ? absolute
      : path.join(await resolvedFilePath(parent), path.basename(absolute));
  }
}
export async function sameFile(a: string, b: string) {
  const [ra, rb] = await Promise.all([
    resolvedFilePath(a),
    resolvedFilePath(b),
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
  private contents = new WeakMap<FileTab, DocumentContentState>();
  // Queue at invocation time, before realpath/conflict checks can reorder requests.
  // One workspace queue also covers aliases and Save As to the same target.
  private writes: Promise<unknown> = Promise.resolve();
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
    savedContent?: string,
  ): FileTab {
    if (this.tabs.size >= MAX_TABS)
      throw new Error(
        "Открыто 100 вкладок. Закройте ненужные перед открытием новой.",
      );
    const tab: FileTab = {
      sessionId: uid(),
      untitledName: nextUntitledName(this.tabs.values()),
      document,
      path: file,
      savedContent: savedContent ?? serializePreparedDocument(document),
      dirty: false,
      recovered: false,
      fingerprint: null,
    };
    const content = new DocumentContentState(document,
      savedContent === undefined ? document : parseDocument(savedContent));
    this.contents.set(tab, content);
    tab.dirty = content.dirty;
    this.tabs.set(tab.sessionId, tab);
    this.activeId = tab.sessionId;
    return tab;
  }
  update(id: string, document: AxonDocument, view?: ViewState) {
    const tab = this.get(id);
    tab.document = document;
    const content = this.contents.get(tab)!;
    content.update(document);
    tab.dirty = content.dirty;
    if (view) tab.view = view;
    return tab;
  }
  updateView(id: string, view: ViewState) {
    this.get(id).view = view;
  }
  async open(file: string) {
    for (const tab of this.tabs.values())
      if (tab.path && (await sameFile(tab.path, file))) {
        this.activeId = tab.sessionId;
        return tab;
      }
    const resolved = await realpath(file);
    if ((await stat(resolved)).size > MAX_DOCUMENT_BYTES)
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
  save(tab: FileTab, file: string, snapshot: AxonDocument): Promise<string> {
    const writing = this.writes.catch(() => {}).then(() => this.write(tab, file, snapshot));
    this.writes = writing;
    return writing;
  }
  private async write(tab: FileTab, file: string, snapshot: AxonDocument) {
    if (this.tabs.get(tab.sessionId) !== tab) throw new Error("Вкладка уже закрыта");
    for (const other of this.tabs.values())
      if (other !== tab && other.path && (await sameFile(other.path, file)))
        throw new Error(
          "Этот файл уже открыт в другой вкладке. Выберите другое имя.",
        );
    // Resolve the parent before writing. If realpath fails after a successful
    // atomic write, keep its known canonical target and report the written state.
    const target = path.join(
      await resolvedFilePath(path.dirname(path.resolve(file))),
      path.basename(file),
    );
    if (this.tabs.get(tab.sessionId) !== tab) throw new Error("Вкладка уже закрыта");
    const savedContent = await writePreparedDocument(file, snapshot);
    const savedPath = await realpath(file).catch(() => target);
    if (this.tabs.get(tab.sessionId) !== tab) return savedPath;
    tab.path = savedPath;
    tab.savedContent = savedContent;
    tab.fingerprint = createHash("sha256")
      .update(tab.savedContent)
      .digest("hex");
    const content = this.contents.get(tab)!;
    content.markSaved(snapshot);
    tab.dirty = content.dirty;
    tab.recovered = false;
    tab.unavailable = false;
    return savedPath;
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
        saved = parseDocument(entry.savedContent),
        savedContent = serializePreparedDocument(saved);
      const file = typeof entry.path === "string" ? entry.path : null;
      const unavailable = !!file && !(await stat(file).catch(() => null));
      const content = new DocumentContentState(document, saved);
      const dirty = content.dirty;
      const tab = {
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
      };
      restored.push(tab);
      this.contents.set(tab, content);
    }
    this.tabs = new Map(restored.map((t) => [t.sessionId, t]));
    this.activeId =
      raw.activeId && this.tabs.has(raw.activeId)
        ? raw.activeId
        : (restored[0]?.sessionId ?? "");
    if (!this.tabs.size) this.add();
  }
}
