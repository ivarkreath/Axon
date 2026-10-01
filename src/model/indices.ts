import type { AxonDocument, AxonObject } from "./document";

export type DocumentIndex = {
  byId: Map<string, AxonObject>;
  order: Map<string, number>;
  groups: Map<string, string[]>;
  children: Map<string, string[]>;
  branches: Map<string, string[]>;
  dependentConnections: Map<string, string[]>;
};
const indices = new WeakMap<AxonObject[], DocumentIndex>();

function append(map: Map<string, string[]>, key: string, id: string) {
  const values = map.get(key);
  if (values) values.push(id);
  else map.set(key, [id]);
}

export function getDocumentIndex(doc: AxonDocument): DocumentIndex {
  const cached = indices.get(doc.objects);
  if (cached) return cached;
  const index: DocumentIndex = {
    byId: new Map(),
    order: new Map(),
    groups: new Map(),
    children: new Map(),
    branches: new Map(),
    dependentConnections: new Map(),
  };
  doc.objects.forEach((o, position) => {
    index.byId.set(o.id, o);
    index.order.set(o.id, position);
    if (o.groupId) append(index.groups, o.groupId, o.id);
    if (o.type === "shape" && o.mind?.parentId)
      append(index.children, o.mind.parentId, o.id);
    if (o.type !== "connector") return;
    const endpoints = new Set(
      [o.start, o.end].flatMap((e) => (e.type === "bound" ? [e.nodeId] : [])),
    );
    for (const id of endpoints) append(index.dependentConnections, id, o.id);
    if (o.mindBranch && o.start.type === "bound")
      for (const id of new Set([o.mindBranch, o.start.nodeId]))
        append(index.branches, id, o.id);
  });
  indices.set(doc.objects, index);
  return index;
}

function sameTopology(a: AxonObject, b: AxonObject) {
  if (a.id !== b.id || a.type !== b.type || a.groupId !== b.groupId)
    return false;
  if (
    a.type === "shape" &&
    b.type === "shape" &&
    a.mind?.parentId !== b.mind?.parentId
  )
    return false;
  if (a.type === "connector" && b.type === "connector") {
    if (a.mindBranch !== b.mindBranch) return false;
    for (const end of ["start", "end"] as const) {
      const left = a[end],
        right = b[end];
      if (
        left.type !== right.type ||
        (left.type === "bound" &&
          right.type === "bound" &&
          left.nodeId !== right.nodeId)
      )
        return false;
    }
  }
  return true;
}

// Reuse topology while geometry changes. The object lookup follows the new
// immutable snapshot; WeakMap lifetime is bounded by live documents/history.
export function cacheDocumentIndex(before: AxonDocument, after: AxonDocument) {
  if (
    indices.has(after.objects) ||
    before.objects.length !== after.objects.length
  )
    return;
  const previous = indices.get(before.objects);
  if (!previous) return;
  const changed: AxonObject[] = [];
  for (let i = 0; i < after.objects.length; i++) {
    const old = before.objects[i],
      next = after.objects[i];
    if (old === next) continue;
    if (!sameTopology(old, next)) return;
    changed.push(next);
  }
  const byId = changed.length ? new Map(previous.byId) : previous.byId;
  for (const object of changed) byId.set(object.id, object);
  indices.set(after.objects, { ...previous, byId });
}
