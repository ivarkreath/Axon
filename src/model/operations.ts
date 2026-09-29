import {
  type AxonDocument,
  type AxonObject,
  type Point,
  uid,
  pruneAssets,
} from "./document";
import { endpoint, objectBounds, union } from "./geometry";
export function expandSelection(doc: AxonDocument, ids: string[]): string[] {
  const groups = new Set(
    doc.objects
      .filter((o) => ids.includes(o.id) && o.groupId)
      .map((o) => o.groupId),
  );
  return doc.objects
    .filter((o) => ids.includes(o.id) || (o.groupId && groups.has(o.groupId)))
    .map((o) => o.id);
}
export function deleteObjects(doc: AxonDocument, ids: string[]): AxonDocument {
  const removed = new Set(
    expandSelection(doc, ids).filter(
      (id) => !doc.objects.find((o) => o.id === id)?.locked,
    ),
  );
  return pruneAssets({
    ...doc,
    objects: doc.objects.filter(
      (o) =>
        !removed.has(o.id) &&
        !(
          o.type === "connector" &&
          [o.start, o.end].some(
            (e) => e.type === "bound" && removed.has(e.nodeId),
          )
        ),
    ),
  });
}
export function moveObjects(
  doc: AxonDocument,
  ids: string[],
  delta: Point,
): AxonDocument {
  const selected = new Set(expandSelection(doc, ids));
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (!selected.has(o.id) || o.locked) return o;
      if (o.type === "connector") {
        const shift = (e: typeof o.start) =>
          e.type === "free" ? { ...e, x: e.x + delta.x, y: e.y + delta.y } : e;
        return { ...o, start: shift(o.start), end: shift(o.end) };
      }
      return { ...o, x: o.x + delta.x, y: o.y + delta.y };
    }),
  };
}
export function copySubset(doc: AxonDocument, ids: string[]): AxonDocument {
  const selected = new Set(expandSelection(doc, ids));
  for (const o of doc.objects)
    if (
      o.type === "connector" &&
      o.start.type === "bound" &&
      o.end.type === "bound" &&
      selected.has(o.start.nodeId) &&
      selected.has(o.end.nodeId)
    )
      selected.add(o.id);
  const objects = doc.objects
    .filter((o) => selected.has(o.id))
    .map((o) =>
      o.type === "connector"
        ? {
            ...o,
            start:
              o.start.type === "bound" && !selected.has(o.start.nodeId)
                ? { type: "free" as const, ...endpoint(o.start, doc) }
                : o.start,
            end:
              o.end.type === "bound" && !selected.has(o.end.nodeId)
                ? { type: "free" as const, ...endpoint(o.end, doc) }
                : o.end,
          }
        : o,
    );
  return pruneAssets({ ...doc, objects });
}
export function pasteObjects(
  doc: AxonDocument,
  source: AxonDocument,
  delta: Point = { x: 32, y: 32 },
): { doc: AxonDocument; ids: string[] } {
  const idMap = new Map(source.objects.map((o) => [o.id, uid()]));
  const groupMap = new Map<string, string>();
  const assetMap = new Map(Object.keys(source.assets).map((id) => [id, uid()]));
  const objects: AxonObject[] = source.objects.map((original) => {
    const o = structuredClone(original);
    o.id = idMap.get(o.id)!;
    o.locked = false;
    if (o.groupId) {
      if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, uid());
      o.groupId = groupMap.get(o.groupId);
    }
    o.x += delta.x;
    o.y += delta.y;
    if (o.type === "image") o.assetId = assetMap.get(o.assetId)!;
    if (o.type === "connector") {
      const cloneEnd = (e: typeof o.start) =>
        e.type === "bound" && idMap.has(e.nodeId)
          ? { ...e, nodeId: idMap.get(e.nodeId)! }
          : {
              type: "free" as const,
              x: endpoint(e, source).x + delta.x,
              y: endpoint(e, source).y + delta.y,
            };
      o.start = cloneEnd(o.start);
      o.end = cloneEnd(o.end);
    }
    return o;
  });
  const assets = { ...doc.assets };
  for (const [key, a] of Object.entries(source.assets)) {
    const id = assetMap.get(key)!;
    assets[id] = { ...a, id };
  }
  return {
    doc: { ...doc, objects: [...doc.objects, ...objects], assets },
    ids: objects.map((o) => o.id),
  };
}
export function groupObjects(
  doc: AxonDocument,
  ids: string[],
  ungroup = false,
): AxonDocument {
  const selected = new Set(expandSelection(doc, ids));
  if (
    [...selected].some((id) => doc.objects.find((o) => o.id === id)?.locked) ||
    (!ungroup && selected.size < 2)
  )
    return doc;
  const groupId = uid();
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (!selected.has(o.id)) return o;
      const copy = { ...o };
      if (ungroup) delete copy.groupId;
      else copy.groupId = groupId;
      return copy;
    }),
  };
}
export function lockObjects(
  doc: AxonDocument,
  ids: string[],
  locked: boolean,
): AxonDocument {
  const selected = new Set(expandSelection(doc, ids));
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      selected.has(o.id) ? { ...o, locked } : o,
    ),
  };
}
export function reorder(
  doc: AxonDocument,
  ids: string[],
  direction: "front" | "back" | "forward" | "backward",
): AxonDocument {
  const selected = new Set(
    expandSelection(doc, ids).filter(
      (id) => !doc.objects.find((o) => o.id === id)?.locked,
    ),
  );
  const list = [...doc.objects];
  if (direction === "front" || direction === "back") {
    const a = list.filter((o) => selected.has(o.id)),
      b = list.filter((o) => !selected.has(o.id));
    return {
      ...doc,
      objects: direction === "front" ? [...b, ...a] : [...a, ...b],
    };
  }
  if (direction === "forward") {
    for (let i = list.length - 2; i >= 0; i--)
      if (selected.has(list[i].id) && !selected.has(list[i + 1].id))
        [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else
    for (let i = 1; i < list.length; i++)
      if (selected.has(list[i].id) && !selected.has(list[i - 1].id))
        [list[i], list[i - 1]] = [list[i - 1], list[i]];
  return { ...doc, objects: list };
}
export type Align =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom"
  | "distributeX"
  | "distributeY";
export function alignObjects(
  doc: AxonDocument,
  ids: string[],
  mode: Align,
): AxonDocument {
  // Each flat group is an indivisible unit for alignment/distribution.
  const selected = expandSelection(doc, ids);
  const units = new Map<string, AxonObject[]>();
  for (const o of doc.objects)
    if (selected.includes(o.id) && !o.locked && o.type !== "connector") {
      const key = o.groupId ?? o.id;
      units.set(key, [...(units.get(key) ?? []), o]);
    }
  const entries = [...units.values()].map((objects) => ({
    objects,
    box: union(objects.map((o) => objectBounds(o, doc)))!,
  }));
  if (entries.length < 2) return doc;
  const all = union(entries.map((e) => e.box))!;
  const horizontal = ["left", "centerX", "right", "distributeX"].includes(mode);
  let result = doc;
  if (mode.startsWith("distribute")) {
    if (entries.length < 3) return doc;
    const axis = horizontal ? "x" : "y",
      size = horizontal ? "w" : "h";
    entries.sort((a, b) => a.box[axis] - b.box[axis]);
    const gap =
      (all[size] - entries.reduce((s, e) => s + e.box[size], 0)) /
      (entries.length - 1);
    let cursor = all[axis];
    for (const e of entries) {
      result = moveObjects(
        result,
        e.objects.map((o) => o.id),
        {
          x: horizontal ? cursor - e.box.x : 0,
          y: horizontal ? 0 : cursor - e.box.y,
        },
      );
      cursor += e.box[size] + gap;
    }
    return result;
  }
  for (const e of entries) {
    const b = e.box;
    let x = 0,
      y = 0;
    if (mode === "left") x = all.x - b.x;
    if (mode === "right") x = all.x + all.w - b.x - b.w;
    if (mode === "centerX") x = all.x + all.w / 2 - b.x - b.w / 2;
    if (mode === "top") y = all.y - b.y;
    if (mode === "bottom") y = all.y + all.h - b.y - b.h;
    if (mode === "centerY") y = all.y + all.h / 2 - b.y - b.h / 2;
    result = moveObjects(
      result,
      e.objects.map((o) => o.id),
      { x, y },
    );
  }
  return result;
}
