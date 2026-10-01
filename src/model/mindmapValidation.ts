import type { AxonObject } from "./document";

type MindIssue = "Повреждённая структура mind map" | "Недопустимый корень mind map" | null;
export type MindMapIssue = { object: AxonObject; message: string };

/** Business invariants for structurally parsed objects; no geometry guessing. */
export function validateMindMap(
  doc: { version: number; objects: AxonObject[] },
  nodes = new Map(doc.objects.map((object) => [object.id, object])),
): MindMapIssue[] {
  const issues: MindMapIssue[] = [];
  const branchCounts = new Map<string, number>();
  for (const object of doc.objects)
    if (object.type === "connector" && object.mindBranch)
      branchCounts.set(object.mindBranch, (branchCounts.get(object.mindBranch) ?? 0) + 1);
  const ancestry = new Map<string, MindIssue>();
  // Duplicate IDs are rejected by the document boundary; retain their original
  // traversal diagnostics instead of conflating nodes in the ancestry cache.
  const cacheAncestry = nodes.size === doc.objects.length;
  const mindIssue = (node: Extract<AxonObject, { type: "shape" }>): MindIssue => {
    const path = new Set<string>();
    let current = node;
    let issue: MindIssue = null;
    for (;;) {
      if (cacheAncestry && ancestry.has(current.id)) {
        issue = ancestry.get(current.id)!;
        break;
      }
      path.add(current.id);
      if (!current.mind?.parentId) {
        if (current.id !== node.mind!.treeId)
          issue = "Недопустимый корень mind map";
        break;
      }
      const parent = nodes.get(current.mind.parentId);
      if (
        !parent || parent.type !== "shape" || !parent.mind ||
        parent.mind.treeId !== node.mind!.treeId || path.has(parent.id)
      ) {
        issue = "Повреждённая структура mind map";
        break;
      }
      current = parent;
    }
    if (cacheAncestry)
      for (const id of path) ancestry.set(id, issue);
    return issue;
  };
  for (const object of doc.objects) {
    const report = (message: string) => issues.push({ object, message });
    if (object.type === "shape" && object.mind) {
      if (doc.version < 3 && (object.mind.side || object.mind.presentation))
        report("Текстовые темы требуют формат версии 3");
      const directParent = object.mind.parentId
        ? nodes.get(object.mind.parentId)
        : undefined;
      if (
        object.mind.presentation === "text" &&
        (!object.mind.side ||
          (directParent?.type === "shape" && directParent.mind?.parentId &&
            directParent.mind.side && directParent.mind.side !== object.mind.side))
      )
        report("Несогласованное направление ветви mind map");
      const issue = mindIssue(object);
      if (issue) report(issue);
      if ((branchCounts.get(object.id) ?? 0) !== (object.mind.parentId ? 1 : 0))
        report("Отсутствует или повторяется ветвь mind map");
    }
    if (object.type === "connector" && object.mindBranch) {
      const child = nodes.get(object.mindBranch);
      if (
        !child || child.type !== "shape" || !child.mind?.parentId ||
        object.start.type !== "bound" || object.end.type !== "bound" ||
        object.start.nodeId !== child.mind.parentId || object.end.nodeId !== child.id
      )
        report("Недопустимая структурная связь");
    }
  }
  return issues;
}
