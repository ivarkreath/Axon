import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { type AxonDocument, type Point } from "../model/document";
import {
  endpoint,
  intersects,
  nearestAnchor,
  objectBounds,
  rect,
  screenToWorld,
  union,
  type Camera,
} from "../model/geometry";
import { expandSelection, moveObjects } from "../model/operations";
import { snap } from "../model/snapping";
import { editor } from "./store";
import { resizeObject } from "./resize";
type Gesture = {
  kind: "pan" | "move" | "resize" | "draw" | "marquee" | "end";
  start: Point;
  screen: Point;
  before: AxonDocument;
  camera: Camera;
  ids: string[];
  id?: string;
  handle?: string;
  end?: "start" | "end";
  shift?: boolean;
};
export function useGestures(space: React.RefObject<boolean>) {
  const gesture = useRef<Gesture | null>(null);
  function position(e: ReactPointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button === 2) return;
    editor.endText();
    const state = editor.state;
    const screen = position(e),
      p = screenToWorld(screen, state.camera);
    const target = e.target as Element;
    const id =
      target.closest("[data-object-id]")?.getAttribute("data-object-id") ??
      undefined;
    const handle = target.getAttribute("data-handle") ?? undefined;
    const end = target.getAttribute("data-end") as "start" | "end" | null;
    const base = {
      start: p,
      screen,
      before: state.doc,
      camera: state.camera,
      ids: state.selection,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current || state.tool === "hand") {
      gesture.current = { ...base, kind: "pan" };
      e.preventDefault();
      return;
    }
    if (handle && id) {
      gesture.current = { ...base, kind: "resize", id, handle };
      return;
    }
    if (end && id) {
      gesture.current = { ...base, kind: "end", id, end };
      return;
    }
    if (state.tool === "select") {
      if (id) {
        const group = expandSelection(state.doc, [id]);
        const ids = e.shiftKey
          ? state.selection.includes(id)
            ? state.selection.filter((i) => !group.includes(i))
            : [...state.selection, ...group]
          : state.selection.includes(id)
            ? state.selection
            : group;
        editor.select(ids);
        gesture.current = { ...base, kind: "move", ids };
      } else {
        if (!e.shiftKey) editor.select([]);
        gesture.current = { ...base, kind: "marquee", shift: e.shiftKey };
      }
      return;
    }
    const o = editor.newObject(state.tool, p);
    if (o.type === "connector")
      o.start = nearestAnchor(p, state.doc, state.camera.zoom);
    if (o.type !== "text" && o.type !== "sticky") {
      o.w = 1;
      o.h = 1;
    }
    if (o.type === "connector") o.end = { type: "free", ...p };
    editor.preview({ ...state.doc, objects: [...state.doc.objects, o] });
    editor.select([o.id]);
    gesture.current = { ...base, kind: "draw", id: o.id };
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g) return;
    const state = editor.state;
    const screen = position(e),
      p = screenToWorld(screen, g.camera);
    const delta = { x: p.x - g.start.x, y: p.y - g.start.y };
    if (g.kind === "pan") {
      editor.set({
        camera: {
          ...g.camera,
          x: g.camera.x + screen.x - g.screen.x,
          y: g.camera.y + screen.y - g.screen.y,
        },
      });
      return;
    }
    if (g.kind === "marquee") {
      editor.set({ marquee: rect(g.start, p) });
      return;
    }
    if (g.kind === "move") {
      const box = union(
        g.before.objects
          .filter((o) => g.ids.includes(o.id) && !o.locked)
          .map((o) => objectBounds(o, g.before)),
      );
      if (!box) return;
      const snapping = e.altKey
        ? { delta: { x: 0, y: 0 }, guides: [] }
        : snap(
            { ...box, x: box.x + delta.x, y: box.y + delta.y },
            g.before,
            g.ids,
            g.camera.zoom,
            state.prefs.snapObjects,
            state.prefs.snapGrid,
          );
      editor.set({
        doc: moveObjects(g.before, g.ids, {
          x: delta.x + snapping.delta.x,
          y: delta.y + snapping.delta.y,
        }),
        guides: snapping.guides,
      });
      return;
    }
    if (g.kind === "resize") {
      const original = g.before.objects.find((o) => o.id === g.id)!;
      let resized = resizeObject(original, g.handle!, delta, e.shiftKey);
      if (!e.altKey && original.type !== "image") {
        const moving = {
          x: g.handle!.includes("w") ? resized.x : resized.x + resized.w,
          y: g.handle!.includes("n") ? resized.y : resized.y + resized.h,
          w: 0,
          h: 0,
        };
        const s = snap(
          moving,
          g.before,
          [g.id!],
          g.camera.zoom,
          state.prefs.snapObjects,
          state.prefs.snapGrid,
        );
        resized = resizeObject(
          original,
          g.handle!,
          { x: delta.x + s.delta.x, y: delta.y + s.delta.y },
          e.shiftKey,
        );
        editor.set({ guides: s.guides });
      }
      editor.preview({
        ...g.before,
        objects: g.before.objects.map((o) => (o.id === g.id ? resized : o)),
      });
      return;
    }
    if (g.kind === "end") {
      editor.preview({
        ...g.before,
        objects: g.before.objects.map((o) =>
          o.id === g.id && o.type === "connector"
            ? {
                ...o,
                [g.end!]: e.altKey
                  ? { type: "free", ...p }
                  : nearestAnchor(p, g.before, g.camera.zoom),
              }
            : o,
        ),
      });
      return;
    }
    if (g.kind === "draw")
      editor.preview({
        ...state.doc,
        objects: state.doc.objects.map((o) => {
          if (o.id !== g.id) return o;
          if (o.type === "connector")
            return {
              ...o,
              end: e.altKey
                ? { type: "free", ...p }
                : nearestAnchor(p, state.doc, g.camera.zoom),
            };
          if (o.type === "stroke") {
            const last = o.points.at(-1)!;
            if (
              Math.hypot(p.x - o.x - last.x, p.y - o.y - last.y) <
              1 / g.camera.zoom
            )
              return o;
            return {
              ...o,
              points: [...o.points, { x: p.x - o.x, y: p.y - o.y }],
            };
          }
          if (o.type === "text") return o;
          let endPoint = p;
          if (e.shiftKey) {
            const size = Math.max(Math.abs(delta.x), Math.abs(delta.y));
            endPoint = {
              x: g.start.x + Math.sign(delta.x || 1) * size,
              y: g.start.y + Math.sign(delta.y || 1) * size,
            };
          }
          return {
            ...o,
            ...rect(g.start, endPoint),
            w: Math.max(1, Math.abs(endPoint.x - g.start.x)),
            h: Math.max(1, Math.abs(endPoint.y - g.start.y)),
          };
        }),
      });
  }
  function up() {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const state = editor.state;
    if (g.kind === "marquee") {
      if (state.marquee) {
        const ids = state.doc.objects
          .filter((o) => intersects(objectBounds(o, state.doc), state.marquee!))
          .map((o) => o.id);
        editor.select(g.shift ? [...g.ids, ...ids] : ids);
      }
    } else if (g.kind !== "pan") {
      if (g.kind === "draw") {
        editor.preview({
          ...state.doc,
          objects: state.doc.objects.map((o) => {
            if (o.id !== g.id) return o;
            if (o.type === "connector") {
              const a = endpoint(o.start, state.doc),
                b = endpoint(o.end, state.doc);
              if (Math.hypot(a.x - b.x, a.y - b.y) < 5)
                return {
                  ...o,
                  end: { type: "free" as const, x: a.x + 160, y: a.y },
                };
              return o;
            }
            if (o.type === "stroke") return o;
            return {
              ...o,
              w: o.w < 12 ? (o.type === "sticky" ? 200 : 180) : o.w,
              h: o.h < 12 ? (o.type === "sticky" ? 180 : 100) : o.h,
            };
          }),
        });
      }
      editor.commit(g.before);
      if (g.kind === "draw") {
        const o = editor.state.doc.objects.find((o) => o.id === g.id);
        if (o?.type !== "stroke") editor.set({ tool: "select" });
        if (o?.type === "text" || o?.type === "sticky") editor.beginText(o.id);
      }
    }
    editor.set({ marquee: null, guides: [] });
  }
  function cancel() {
    const g = gesture.current;
    if (g) {
      if (g.kind !== "pan") editor.preview(g.before);
      else editor.set({ camera: g.camera });
      gesture.current = null;
    }
    editor.set({ marquee: null, guides: [] });
  }
  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: cancel,
    cancel,
  };
}
