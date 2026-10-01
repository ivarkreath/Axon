import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createObject,
  documentSchema,
  emptyDocument,
  type AxonDocument,
  type Bounds,
  type Connector,
} from "../src/model/document";
import * as geometry from "../src/model/geometry";
import { cacheDocumentIndex, getDocumentIndex } from "../src/model/indices";
import {
  expandSelection,
  moveObjects,
  prepareMove,
} from "../src/model/operations";
import { prepareSnap, snap, type Guide } from "../src/model/snapping";
import { prepareScaleSelection, scaleSelection } from "../src/model/transform";

afterEach(() => vi.restoreAllMocks());

function scene() {
  const doc = emptyDocument();
  const a = {
    ...createObject("shape", { x: 0, y: 0 }, doc.background),
    id: "a",
    groupId: "group",
  };
  const b = {
    ...createObject("shape", { x: 400, y: 0 }, doc.background),
    id: "b",
    groupId: "group",
  };
  const c = {
    ...createObject("shape", { x: 800, y: 200 }, doc.background),
    id: "c",
  };
  const connection = {
    ...createObject("connector", a, doc.background),
    id: "link",
    start: { type: "bound", nodeId: a.id, side: "right" },
    end: { type: "bound", nodeId: b.id, side: "left" },
  } as Connector;
  doc.objects = [a, b, c, connection];
  return doc;
}

// Original loop retained as an oracle for tie ordering and screen-space threshold.
function referenceSnap(
  box: Bounds,
  doc: AxonDocument,
  excluded: string[],
  zoom: number,
  grid: boolean,
) {
  const delta = {
    x: grid ? Math.round(box.x / 20) * 20 - box.x : 0,
    y: grid ? Math.round(box.y / 20) * 20 - box.y : 0,
  };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "w" : "h";
    let best = 6 / zoom;
    let found: number | undefined;
    for (const object of doc.objects) {
      if (excluded.includes(object.id) || object.type === "connector") continue;
      const b = geometry.objectBounds(object, doc);
      for (const source of [
        box[axis],
        box[axis] + box[size] / 2,
        box[axis] + box[size],
      ])
        for (const target of [
          b[axis],
          b[axis] + b[size] / 2,
          b[axis] + b[size],
        ])
          if (Math.abs(target - source) < best) {
            best = Math.abs(target - source);
            delta[axis] = target - source;
            found = target;
          }
    }
    if (found !== undefined) guides.push({ axis, value: found });
  }
  return { delta, guides };
}

describe("review: immutable gesture caches", () => {
  it("excludes every moving descendant and structural branch from snap candidates", () => {
    const doc = emptyDocument();
    const root = createObject("shape", { x: 0, y: 0 }, doc.background);
    const child = createObject("shape", { x: 300, y: 0 }, doc.background);
    if (root.type !== "shape" || child.type !== "shape")
      throw new Error("shape");
    root.mind = { treeId: root.id, parentId: null, order: 0 };
    child.mind = { treeId: root.id, parentId: root.id, order: 0 };
    const branch = {
      ...createObject("connector", root, doc.background),
      mindBranch: child.id,
      start: { type: "bound", nodeId: root.id, side: "right" },
      end: { type: "bound", nodeId: child.id, side: "left" },
    } as Connector;
    const fixed = createObject("shape", { x: 800, y: 0 }, doc.background);
    doc.objects = [root, child, branch, fixed];
    const prepared = prepareMove(doc, [root.id]);
    expect([...prepared.selected]).toEqual([root.id, child.id, branch.id]);
    const targets = prepareSnap(doc, [...prepared.selected]);
    expect(targets).toEqual([geometry.objectBounds(fixed, doc)]);
    const moved = moveObjects(doc, [root.id], { x: 25, y: 10 }, prepared);
    expect(moved.objects[1].x).toBe(child.x + 25);
    expect(geometry.endpoint(branch.end, moved).x).toBe(child.x + 25);
    expect(moved.objects[3]).toBe(fixed);
  });

  it("retains topology indices across geometry changes and invalidates rebindings and groups", () => {
    const doc = scene();
    const original = getDocumentIndex(doc);
    expect(expandSelection(doc, ["a"])).toEqual(["a", "b"]);
    expect(expandSelection(doc, ["a"])).toEqual(["a", "b"]);
    const moved = moveObjects(doc, ["a"], { x: 35, y: -12 });
    cacheDocumentIndex(doc, moved);
    const next = getDocumentIndex(moved);
    expect(next.groups).toBe(original.groups);
    expect(next.children).toBe(original.children);
    expect(next.dependentConnections).toBe(original.dependentConnections);
    expect(next.byId.get("a")?.x).toBe(35);
    expect(original.byId.get("a")?.x).toBe(0);
    const link = next.byId.get("link") as Connector;
    const rebound = {
      ...moved,
      objects: moved.objects.map((o) =>
        o === link
          ? {
              ...link,
              end: {
                type: "bound" as const,
                nodeId: "c",
                side: "left" as const,
              },
            }
          : o,
      ),
    };
    cacheDocumentIndex(moved, rebound);
    const changed = getDocumentIndex(rebound);
    expect(changed.dependentConnections.get("b")).toBeUndefined();
    expect(changed.dependentConnections.get("c")).toEqual(["link"]);
    const ungrouped = {
      ...rebound,
      objects: rebound.objects.map((o) =>
        o.id === "a" ? { ...o, groupId: undefined } : o,
      ),
    };
    cacheDocumentIndex(rebound, ungrouped);
    expect(expandSelection(ungrouped, ["a"])).toEqual(["a"]);
    expect(getDocumentIndex(doc)).toBe(original);
  });

  it("computes static candidate bounds once per object and preserves snap results at every zoom", () => {
    const doc = scene();
    const bounds = vi.spyOn(geometry, "objectBounds");
    const targets = prepareSnap(doc, ["a"]);
    expect(bounds).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 50; i++)
      snap(
        { x: 215 + i, y: i, w: 180, h: 100 },
        doc,
        ["a"],
        1,
        true,
        false,
        targets,
      );
    expect(bounds).toHaveBeenCalledTimes(2);
    for (const zoom of [0.1, 0.5, 1, 2, 4])
      for (const grid of [false, true])
        for (let i = 0; i < 25; i++) {
          const box = { x: 170 + i * 10.2, y: -12 + i * 3.6, w: 180, h: 100 };
          expect(snap(box, doc, ["a"], zoom, true, grid, targets)).toEqual(
            referenceSnap(box, doc, ["a"], zoom, grid),
          );
        }
    bounds.mockClear();
    const changed = {
      ...doc,
      objects: doc.objects.map((o) => (o.id === "b" ? { ...o, x: 455 } : o)),
    };
    prepareSnap(changed, ["a"]);
    expect(bounds).toHaveBeenCalledTimes(1);
  });

  it("moves a prepared group repeatedly from its initial snapshot and preserves attached geometry", () => {
    const doc = scene();
    const prepared = prepareMove(doc, ["a"]);
    const first = moveObjects(doc, ["a"], { x: 10, y: 20 }, prepared);
    const second = moveObjects(doc, ["a"], { x: 30, y: 40 }, prepared);
    expect(second.objects[0].x).toBe(30);
    expect(second.objects[1].x).toBe(430);
    expect(second.objects[2]).toBe(doc.objects[2]);
    const link = doc.objects[3] as Connector;
    expect(
      geometry.endpoint(link.start, second).x -
        geometry.endpoint(link.start, first).x,
    ).toBe(20);
    expect(moveObjects(doc, ["a"], { x: 0, y: 0 }, prepared)).toBe(doc);
    expect(doc.objects[0].x).toBe(0);
  });

  it("reuses scale bounds and validates changed geometry without a full document parse", () => {
    const doc = scene();
    const prepared = prepareScaleSelection(doc, ["a"]);
    expect(prepared.selected.has("link")).toBe(true);
    expect(scaleSelection(doc, ["a"], "se", { x: 0, y: 0 }, prepared)).toBe(
      doc,
    );
    const bounds = vi.spyOn(geometry, "objectBounds");
    const parse = vi.spyOn(documentSchema, "safeParse");
    for (let i = 1; i <= 10; i++) {
      const scaled = scaleSelection(
        doc,
        ["a"],
        "se",
        { x: i * 2, y: i },
        prepared,
      );
      expect(scaled.objects[0].w).toBeGreaterThan(doc.objects[0].w);
      expect(scaled.objects[2]).toBe(doc.objects[2]);
    }
    expect(bounds).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    const locked = {
      ...doc,
      objects: doc.objects.map((o) =>
        o.id === "b" ? { ...o, locked: true } : o,
      ),
    };
    expect(scaleSelection(locked, ["a"], "se", { x: 10, y: 10 })).toBe(locked);
  });
});
