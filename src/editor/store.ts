import { useSyncExternalStore } from "react";
import {
  createObject,
  CONNECTOR_STROKE_WIDTH,
  SHAPE_STROKE_WIDTH,
  validateChangedObjects,
  emptyDocument,
  type Asset,
  type AxonDocument,
  type AxonObject,
  type Bounds,
  type Point,
  type ShapeKind,
  type Style,
} from "../model/document";
import { History } from "../model/history";
import {
  alignObjects,
  copySubset,
  deleteObjects,
  expandSelection,
  groupObjects,
  lockObjects,
  moveObjects,
  pasteObjects,
  reorder,
  type Align,
} from "../model/operations";
import { type Camera, fit, zoomAt } from "../model/geometry";
import { contentBounds } from "../rendering/primitives";
import {
  defaults,
  type Preferences,
  type Session,
  type TabSession,
  type SessionUpdate,
} from "../shared/contracts";
import { fitText } from "../rendering/text";
import type { Guide } from "../model/snapping";
import {
  addTopic,
  createTopic,
  reflowChangedTopics,
  topicSide,
  type MindSide,
} from "../model/mindmap";
import { nextUntitledName } from "../shared/documentName";
import { DocumentSession } from "./session";
import { cacheDocumentIndex } from "../model/indices";
export type Tool =
  | "select"
  | "shape"
  | "connector"
  | "text"
  | "sticky"
  | "stroke"
  | "hand"
  | "mindmap";
export type EditorState = {
  sessionId: string;
  doc: AxonDocument;
  selection: string[];
  camera: Camera;
  tool: Tool;
  shape: ShapeKind;
  editing: string | null;
  prefs: Preferences;
  guides: Guide[];
  marquee: Bounds | null;
  viewport: { w: number; h: number };
  interacting: boolean;
};
export class Editor {
  tabs = new Map<string, DocumentSession>();
  cancelGesture: (() => void) | null = null;
  finishGesture: (() => void) | null = null;
  state: EditorState = {
    sessionId: "",
    doc: emptyDocument(),
    selection: [],
    camera: { x: 220, y: 160, zoom: 1 },
    tool: "select",
    shape: "rect",
    editing: null,
    prefs: defaults,
    guides: [],
    marquee: null,
    viewport: { w: 1000, h: 700 },
    interacting: false,
  };
  history = new History();
  private listeners = new Set<() => void>();
  private textBefore: AxonDocument | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  set(patch: Partial<EditorState>) {
    if (patch.doc) cacheDocumentIndex(this.state.doc, patch.doc);
    this.state = { ...this.state, ...patch };
    const tab = this.tabs.get(this.state.sessionId);
    if (tab) {
      tab.update(this.state);
    }
    for (const l of this.listeners) l();
  }
  load(session: Session) {
    this.acceptSession(session);
    this.activate(session.sessionId ?? session.document.id);
  }
  acceptSession(session: Session) {
    const entries: TabSession[] = session.tabs ?? [
      {
        ...session,
        sessionId: session.sessionId ?? session.document.id,
        savedContent: session.savedContent ?? "",
      },
    ];
    for (const entry of entries) {
      const existing = this.tabs.get(entry.sessionId);
      entry.untitledName ??=
        existing?.session.untitledName ??
        nextUntitledName(Array.from(this.tabs.values(), (t) => t.session));
      if (existing) existing.accept(entry);
      else
        this.tabs.set(
          entry.sessionId,
          new DocumentSession(
            {
              ...this.state,
              sessionId: entry.sessionId,
              doc: entry.document,
              editing: null,
              selection: entry.view?.selection ?? [],
              camera: entry.view?.camera ?? { x: 220, y: 160, zoom: 1 },
              tool: "select",
              guides: [],
              marquee: null,
              interacting: false,
              prefs: session.preferences,
            },
            entry,
          ),
        );
    }
    this.set({ prefs: session.preferences });
  }
  activate(id: string) {
    if (!this.tabs.has(id)) return;
    this.finishOperation();
    this.textBefore = null;
    const tab = this.tabs.get(id)!;
    this.history = tab.history;
    this.set({
      ...tab.state,
      viewport: this.state.viewport,
      prefs: this.state.prefs,
    });
  }
  isDirty(id = this.state.sessionId) {
    return this.tabs.get(id)?.content.dirty ?? false;
  }
  finishOperation() {
    this.finishGesture?.();
    this.endText();
  }
  snapshots(): SessionUpdate[] {
    this.finishOperation();
    return [...this.tabs].map(([sessionId, tab]) => ({
      sessionId,
      document: tab.state.doc,
      view: { camera: tab.state.camera, selection: tab.state.selection },
    }));
  }
  closeSession(id: string, result: Session) {
    this.finishOperation();
    this.tabs.delete(id);
    this.acceptSession(result);
    this.activate(result.sessionId ?? result.document.id);
  }
  preview(doc: AxonDocument) {
    this.set({ doc });
  }
  commit(before: AxonDocument, after = this.state.doc) {
    after = this.history.commit(before, after)
      ? { ...after, version: 3 }
      : before;
    this.set({ doc: after });
  }
  change(fn: (doc: AxonDocument) => AxonDocument) {
    this.endText();
    const before = this.state.doc;
    this.commit(before, fn(before));
  }
  select(ids: string[]) {
    this.set({ selection: expandSelection(this.state.doc, ids, false) });
  }
  setTool(tool: Tool) {
    this.cancelGesture?.();
    this.endText();
    this.set({ tool, selection: [], guides: [] });
  }
  undo() {
    this.cancelGesture?.();
    this.endText();
    this.set({ doc: this.history.undo(this.state.doc), selection: [] });
  }
  redo() {
    this.cancelGesture?.();
    this.endText();
    this.set({ doc: this.history.redo(this.state.doc), selection: [] });
  }
  remove() {
    this.change((doc) => deleteObjects(doc, this.state.selection));
    this.set({ selection: [] });
  }
  duplicate() {
    const source = copySubset(this.state.doc, this.state.selection);
    if (!source.objects.length) return;
    const result = pasteObjects(this.state.doc, source);
    this.change(() => result.doc);
    this.select(result.ids);
  }
  group(ungroup = false) {
    this.change((doc) => groupObjects(doc, this.state.selection, ungroup));
  }
  lock() {
    const locked = !this.state.doc.objects
      .filter((o) => this.state.selection.includes(o.id))
      .some((o) => o.locked);
    this.change((doc) => lockObjects(doc, this.state.selection, locked));
  }
  order(direction: Parameters<typeof reorder>[2]) {
    this.change((doc) => reorder(doc, this.state.selection, direction));
  }
  align(mode: Align) {
    this.change((doc) => alignObjects(doc, this.state.selection, mode));
  }
  move(delta: Point) {
    this.change((doc) => moveObjects(doc, this.state.selection, delta));
  }
  patchObject(id: string, patch: Partial<AxonObject>) {
    this.change((doc) => ({
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === id && !o.locked && !o.groupId
          ? fitText({ ...o, ...patch } as AxonObject)
          : o,
      ),
    }));
  }
  style(patch: Partial<Style>) {
    const ids = this.state.selection;
    const changes = (style: Style) => Object.entries(patch).some(
      ([key, value]) => style[key as keyof Style] !== value,
    );
    if (ids.length) {
      this.formatChange((doc) => ({
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) && !o.locked && changes(o.style)
            ? fitText({ ...o, style: { ...o.style, ...patch } })
            : o,
        ),
      }));
      return;
    }
    const key = this.state.tool;
    const base =
      this.newObject(
        key === "select" || key === "hand"
          ? "shape"
          : (key as AxonObject["type"]),
        { x: 0, y: 0 },
      ).style;
    if (!changes(base)) return;
    this.preferences({
      ...this.state.prefs,
      styles: { ...this.state.prefs.styles, [key]: { ...base, ...patch } },
    });
  }
  // Each property choice is its own history action, without leaving the text session.
  formatChange(fn: (doc: AxonDocument) => AxonDocument) {
    const changed = fn(this.state.doc);
    const next = reflowChangedTopics(this.textBefore ?? this.state.doc, changed);
    if (!this.validTextGeometry(next)) return;
    if (this.state.editing) {
      if (this.textBefore) this.commit(this.textBefore, this.state.doc);
      this.commit(this.state.doc, next);
      this.textBefore = this.state.doc;
    }
    else this.change(() => next);
  }
  private validTextGeometry(doc: AxonDocument) {
    if (validateChangedObjects(this.state.doc, doc)) return true;
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent("axon-error", {
          detail:
            "Достигнут предел размера объекта или документа. Уменьшите текст или размер шрифта.",
        }),
      );
    return false;
  }
  useStyleForNew() {
    const objects = this.state.doc.objects.filter((o) =>
      this.state.selection.includes(o.id),
    );
    if (objects.length !== 1) return;
    const o = objects[0];
    this.preferences({
      ...this.state.prefs,
      ...(o.type === "connector"
        ? { connector: { route: o.route, arrows: o.arrows, startMarker: o.startMarker, endMarker: o.endMarker } }
        : {}),
      styles: {
        ...this.state.prefs.styles,
        [o.type === "shape" && o.mind ? "mindmap" : o.type]: { ...o.style },
      },
    });
  }
  resetStyle() {
    if (this.state.selection.length)
      this.formatChange((doc) => ({
        ...doc,
        objects: doc.objects.map((o) =>
          this.state.selection.includes(o.id) && !o.locked
            ? fitText({
                ...o,
                style:
                  o.type === "shape" && o.mind
                    ? createTopic(o, doc.background, !o.mind.parentId).style
                    : createObject(o.type, o, doc.background).style,
              })
            : o,
        ),
      }));
    else {
      const styles = { ...this.state.prefs.styles };
      delete styles[this.state.tool];
      this.preferences({
        ...this.state.prefs,
        styles,
        ...(this.state.tool === "connector"
          ? { connector: defaults.connector }
          : {}),
      });
    }
  }
  topic(
    sibling = false,
    root = false,
    point?: Point,
    side?: MindSide,
    sourceId?: string,
  ) {
    this.endText();
    const o = this.state.doc.objects.find(
      (o) =>
        (sourceId ? o.id === sourceId : this.state.selection.includes(o.id)) &&
        o.type === "shape" &&
        o.mind,
    );
    const parentId = root
      ? undefined
      : o?.type === "shape"
        ? sibling
          ? (o.mind?.parentId ?? o.id)
          : o.id
        : undefined;
    const c = this.state.camera,
      v = this.state.viewport;
    const result = addTopic(
      this.state.doc,
      point ?? { x: (v.w / 2 - c.x) / c.zoom, y: (v.h / 2 - c.y) / c.zoom },
      parentId,
      side ??
        (sibling && o?.type === "shape" && o.mind?.parentId
          ? topicSide(this.state.doc, o)
          : "right"),
      parentId ? undefined : this.state.prefs.styles.mindmap,
    );
    if (result) {
      if (!this.validTextGeometry(result.doc)) return;
      this.change(() => result.doc);
      this.beginText(result.node.id);
    }
  }
  preferences(prefs: Preferences) {
    this.set({ prefs });
    void window.axon
      .preferences(prefs)
      .catch((error) =>
        window.dispatchEvent(
          new CustomEvent("axon-error", { detail: String(error) }),
        ),
      );
  }
  newObject(type: AxonObject["type"] | "mindmap", p: Point) {
    if (type === "mindmap")
      return createTopic(
        p,
        this.state.doc.background,
        true,
        this.state.prefs.styles.mindmap,
      );
    const o = createObject(
      type,
      p,
      this.state.doc.background,
      this.state.shape,
    );
    const style = this.state.prefs.styles[type];
    if (o.type === "connector") Object.assign(o, this.state.prefs.connector);
    return style
      ? {
          ...o,
          style: {
            ...style,
            ...(type === "shape"
              ? { strokeWidth: SHAPE_STROKE_WIDTH }
              : type === "sticky" && style.strokeWidth > 0
                ? { strokeWidth: SHAPE_STROKE_WIDTH }
                : {}),
          },
        }
      : o;
  }
  nodeConnection(p: Point) {
    const connection = this.newObject("connector", p);
    // Node handles create a standard link, independently of the drawing tool's width.
    return {
      ...connection,
      style: { ...connection.style, strokeWidth: CONNECTOR_STROKE_WIDTH },
    };
  }
  connectionDefaults(patch: Partial<AxonObject>) {
    this.preferences({
      ...this.state.prefs,
      connector: {
        ...this.state.prefs.connector,
        ...("route" in patch ? { route: patch.route! } : {}),
        ...("arrows" in patch ? { arrows: patch.arrows! } : {}),
        ...("startMarker" in patch ? { startMarker: patch.startMarker } : {}),
        ...("endMarker" in patch ? { endMarker: patch.endMarker } : {}),
      },
    });
  }
  beginText(id: string) {
    const o = this.state.doc.objects.find((o) => o.id === id);
    if (!o || !("text" in o) || o.locked || o.groupId) return;
    this.endText();
    this.textBefore = this.state.doc;
    this.set({ editing: id, selection: [id], tool: "select" });
  }
  updateText(text: string) {
    const editing = this.state.doc.objects.find((o) => o.id === this.state.editing);
    if (!editing || !("text" in editing) || editing.text === text) return;
    const doc = {
      ...this.state.doc,
      objects: this.state.doc.objects.map((o) =>
        o.id === this.state.editing && "text" in o
          ? fitText({ ...o, text })
          : o,
      ),
    };
    if (this.validTextGeometry(doc)) this.set({ doc });
  }
  endText() {
    if (!this.state.editing) return;
    const before = this.textBefore;
    this.textBefore = null;
    this.set({ editing: null });
    if (before) {
      const after = reflowChangedTopics(before, this.state.doc);
      this.commit(
        before,
        this.validTextGeometry(after) ? after : this.state.doc,
      );
    }
  }
  addImage(asset: Asset, p?: Point) {
    const v = this.state.viewport,
      c = this.state.camera;
    const center = p ?? {
      x: (v.w / 2 - c.x) / c.zoom,
      y: (v.h / 2 - c.y) / c.zoom,
    };
    const scale = Math.min(1, 560 / asset.width, 400 / asset.height);
    const o = this.newObject("image", center);
    if (o.type !== "image") return;
    const img = {
      ...o,
      x: center.x - (asset.width * scale) / 2,
      y: center.y - (asset.height * scale) / 2,
      w: asset.width * scale,
      h: asset.height * scale,
      assetId: asset.id,
    };
    this.change((doc) => ({
      ...doc,
      objects: [...doc.objects, img],
      assets: { ...doc.assets, [asset.id]: asset },
    }));
    this.select([img.id]);
    this.set({ tool: "select" });
  }
  async copy() {
    if (!this.state.selection.length) return;
    const source = copySubset(this.state.doc, this.state.selection);
    if (source.objects.length) await window.axon.writeClipboard(source);
  }
  async paste() {
    const sessionId = this.state.sessionId;
    const data = await window.axon.readClipboard();
    if (this.state.sessionId !== sessionId) return;
    if (data.document) {
      const result = pasteObjects(this.state.doc, data.document);
      this.change(() => result.doc);
      this.select(result.ids);
    } else if (data.image) this.addImage(data.image);
    else if (data.text) {
      const c = this.state.camera,
        v = this.state.viewport;
      const o = this.newObject("text", {
        x: (v.w / 2 - c.x) / c.zoom,
        y: (v.h / 2 - c.y) / c.zoom,
      });
      if (o.type === "text") {
        o.text = data.text;
        this.change((doc) => ({
          ...doc,
          objects: [...doc.objects, fitText(o)],
        }));
        this.select([o.id]);
      }
    }
  }
  fit(selection = false) {
    const objects = selection
      ? this.state.doc.objects.filter((o) =>
          this.state.selection.includes(o.id),
        )
      : this.state.doc.objects;
    this.set({
      camera: fit(
        contentBounds(this.state.doc, objects),
        this.state.viewport.w,
        this.state.viewport.h,
      ),
    });
  }
  zoom(value: number) {
    const { w, h } = this.state.viewport;
    this.set({
      camera: zoomAt(this.state.camera, { x: w / 2, y: h / 2 }, value),
    });
  }
}
export const editor = new Editor();
export const useEditor = () =>
  useSyncExternalStore(editor.subscribe, editor.getSnapshot);
