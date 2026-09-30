import {
  createObject,
  isTextTopic,
  type AxonDocument,
  type AxonObject,
  type Point,
  type Style,
} from "./document";
import { fitText } from "../rendering/text";
type Node = Extract<AxonObject, { type: "shape" }>;
export type MindSide = "left" | "right";
export function topicSide(doc: AxonDocument, node: Node): MindSide {
  if (node.mind?.side) return node.mind.side;
  // Legacy direction is read from a structural endpoint, never from proximity.
  const branch = doc.objects.find(
    (o) => o.type === "connector" && o.mindBranch === node.id,
  );
  return branch?.type === "connector" &&
    branch.start.type === "bound" &&
    branch.start.side === "left"
    ? "left"
    : "right";
}
export function createTopic(
  point: Point,
  background: string,
  root = true,
  style?: Style,
): Node {
  const base = createObject("shape", point, background) as Node;
  return fitText({
    ...base,
    mind: { treeId: base.id, parentId: null, order: 0, presentation: "text" },
    style: {
      ...base.style,
      fill: "none",
      strokeWidth: 0,
      radius: 0,
      padding: 6,
      fontSize: root ? 24 : 18,
      align: "left",
      ...(style
        ? {
            font: style.font,
            fontSize: style.fontSize,
            color: style.color,
            align: style.align,
          }
        : {}),
    },
  });
}
/** Reflows one side of one tree after structural/size changes; never on keystrokes. */
export function layoutTopics(
  doc: AxonDocument,
  changedId: string,
): AxonDocument {
  const changed = doc.objects.find((o) => o.id === changedId);
  if (!changed || changed.type !== "shape" || !changed.mind) return doc;
  const nodes = doc.objects.filter(
    (o): o is Node =>
      o.type === "shape" && o.mind?.treeId === changed.mind!.treeId,
  );
  const byId = new Map(nodes.map((o) => [o.id, o]));
  const root = byId.get(changed.mind.treeId);
  if (!root) return doc;
  const children = new Map<string, Node[]>();
  for (const node of nodes)
    if (node.mind?.parentId)
      children.set(node.mind.parentId, [
        ...(children.get(node.mind.parentId) ?? []),
        node,
      ]);
  for (const list of children.values())
    list.sort((a, b) => a.mind!.order - b.mind!.order);
  const spans = new Map<string, number>();
  const measure = (node: Node): number => {
    if (spans.has(node.id)) return spans.get(node.id)!;
    const list = children.get(node.id) ?? [];
    const height = Math.max(
      node.h,
      list.reduce((n, c) => n + measure(c), 0) +
        Math.max(0, list.length - 1) * 24,
    );
    spans.set(node.id, height);
    return height;
  };
  // Iterative post-order avoids recursion limits for deeply nested valid trees.
  const ordered = [root];
  for (let i = 0; i < ordered.length; i++)
    ordered.push(...(children.get(ordered[i].id) ?? []));
  for (const node of [...ordered].reverse()) measure(node);
  const positions = new Map<string, Point>();
  const sides: MindSide[] =
    changed.id === root.id ? ["left", "right"] : [topicSide(doc, changed)];
  for (const side of sides) {
    const first = (children.get(root.id) ?? []).filter(
      (n) => topicSide(doc, n) === side,
    );
    const queue = [...first];
    for (let i = 0; i < queue.length; i++)
      queue.push(...(children.get(queue[i].id) ?? []));
    if (queue.some((n) => n.locked)) continue;
    const tasks: { parent: Node; list: Node[]; cy: number; x: number }[] = [
      { parent: root, list: first, cy: root.y + root.h / 2, x: root.x },
    ];
    while (tasks.length) {
      const task = tasks.pop()!;
      const total =
        task.list.reduce((n, c) => n + spans.get(c.id)!, 0) +
        Math.max(0, task.list.length - 1) * 24;
      let y = task.cy - total / 2;
      for (const node of task.list) {
        const span = spans.get(node.id)!,
          cy = y + span / 2;
        const x =
          side === "right" ? task.x + task.parent.w + 72 : task.x - 72 - node.w;
        positions.set(node.id, { x, y: cy - node.h / 2 });
        tasks.push({ parent: node, list: children.get(node.id) ?? [], cy, x });
        y += span + 24;
      }
    }
  }
  return {
    ...doc,
    objects: doc.objects.map((o) =>
      positions.has(o.id) ? { ...o, ...positions.get(o.id)! } : o,
    ),
  };
}
export function addTopic(
  doc: AxonDocument,
  point: Point,
  parentId?: string,
  side: MindSide = "right",
  style?: Style,
) {
  const parent = doc.objects.find((o) => o.id === parentId);
  if (
    parentId &&
    (!parent || parent.type !== "shape" || !parent.mind || parent.locked)
  )
    return null;
  const node = createTopic(
    point,
    doc.background,
    !parent,
    style ??
      (parent?.type === "shape"
        ? {
            ...parent.style,
            fontSize: parent.mind?.parentId ? parent.style.fontSize : 18,
          }
        : undefined),
  );
  if (parent?.type === "shape" && parent.mind?.parentId)
    side = topicSide(doc, parent);
  const siblings = doc.objects.filter(
    (o): o is Node =>
      o.type === "shape" && !!o.mind && o.mind.parentId === parentId,
  );
  node.mind = {
    treeId: parent?.type === "shape" ? parent.mind!.treeId : node.id,
    parentId: parentId ?? null,
    order: Math.max(-1, ...siblings.map((o) => o.mind!.order)) + 1,
    side,
    presentation: "text",
  };
  const objects: AxonObject[] = [...doc.objects, node];
  if (parent) {
    const branch = createObject("connector", point, doc.background);
    if (branch.type === "connector")
      objects.push({
        ...branch,
        route: "curved",
        arrows: "none",
        mindBranch: node.id,
        style: { ...branch.style, strokeWidth: 1.5, dash: false },
        start: { type: "bound", nodeId: parent.id, side },
        end: {
          type: "bound",
          nodeId: node.id,
          side: side === "right" ? "left" : "right",
        },
      });
  }
  const result = layoutTopics({ ...doc, version: 3, objects }, node.id);
  return {
    doc: result,
    node: result.objects.find((o) => o.id === node.id)! as Node,
  };
}
export function reflowChangedTopics(before: AxonDocument, after: AxonDocument) {
  let result = after;
  const old = new Map(before.objects.map((o) => [o.id, o]));
  const changed = after.objects.filter(
    (o) =>
      isTextTopic(o) &&
      old.has(o.id) &&
      (o.w !== old.get(o.id)!.w || o.h !== old.get(o.id)!.h),
  );
  const done = new Set<string>();
  for (const o of changed)
    if (o.type === "shape" && o.mind) {
      const key =
        o.mind.treeId + (o.mind.parentId ? topicSide(after, o) : "root");
      if (!done.has(key)) {
        result = layoutTopics(result, o.id);
        done.add(key);
      }
    }
  return result;
}
