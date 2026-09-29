import { useSyncExternalStore } from "react";
import {
  createObject,
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
import { defaults, type Preferences, type Session } from "../shared/contracts";
import { fitText } from "../rendering/text";
import type { Guide } from "../model/snapping";
export type Tool =
  "select" | "shape" | "connector" | "text" | "sticky" | "stroke" | "hand";
export type EditorState = {
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
};
class Editor {
  state: EditorState = {
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
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  load(session: Session) {
    this.history.clear();
    this.textBefore = null;
    this.set({
      doc: session.document,
      selection: [],
      editing: null,
      prefs: session.preferences,
      tool: "select",
    });
    this.fit();
  }
  preview(doc: AxonDocument) {
    this.set({ doc });
  }
  commit(before: AxonDocument, after = this.state.doc) {
    this.history.commit(before, after);
    this.set({ doc: after });
  }
  change(fn: (doc: AxonDocument) => AxonDocument) {
    this.endText();
    const before = this.state.doc;
    this.commit(before, fn(before));
  }
  select(ids: string[]) {
    this.set({ selection: expandSelection(this.state.doc, ids) });
  }
  setTool(tool: Tool) {
    this.endText();
    this.set({ tool, selection: [], guides: [] });
  }
  undo() {
    this.endText();
    this.set({ doc: this.history.undo(this.state.doc), selection: [] });
  }
  redo() {
    this.endText();
    this.set({ doc: this.history.redo(this.state.doc), selection: [] });
  }
  remove() {
    this.change((doc) => deleteObjects(doc, this.state.selection));
    this.set({ selection: [] });
  }
  duplicate() {
    const source = copySubset(this.state.doc, this.state.selection);
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
    if (ids.length)
      this.change((doc) => ({
        ...doc,
        objects: doc.objects.map((o) =>
          ids.includes(o.id) && !o.locked && !o.groupId
            ? fitText({ ...o, style: { ...o.style, ...patch } })
            : o,
        ),
      }));
    const selected = this.state.doc.objects.find((o) => ids.includes(o.id));
    const key = selected?.type ?? this.state.tool;
    const base =
      selected?.style ??
      this.newObject(
        key === "select" || key === "hand"
          ? "shape"
          : (key as AxonObject["type"]),
        { x: 0, y: 0 },
      ).style;
    this.preferences({
      ...this.state.prefs,
      styles: { ...this.state.prefs.styles, [key]: { ...base, ...patch } },
    });
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
  newObject(type: AxonObject["type"], p: Point) {
    const o = createObject(
      type,
      p,
      this.state.doc.background,
      this.state.shape,
    );
    const style = this.state.prefs.styles[type];
    return style ? { ...o, style: { ...style } } : o;
  }
  beginText(id: string) {
    const o = this.state.doc.objects.find((o) => o.id === id);
    if (!o || !("text" in o) || o.locked || o.groupId) return;
    this.endText();
    this.textBefore = this.state.doc;
    this.set({ editing: id, selection: [id], tool: "select" });
  }
  updateText(text: string) {
    this.set({
      doc: {
        ...this.state.doc,
        objects: this.state.doc.objects.map((o) =>
          o.id === this.state.editing && "text" in o
            ? fitText({ ...o, text })
            : o,
        ),
      },
    });
  }
  endText() {
    if (!this.state.editing) return;
    const before = this.textBefore;
    this.textBefore = null;
    this.set({ editing: null });
    if (before) this.commit(before);
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
    if (this.state.selection.length)
      await window.axon.writeClipboard(
        copySubset(this.state.doc, this.state.selection),
      );
  }
  async paste() {
    const data = await window.axon.readClipboard();
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
