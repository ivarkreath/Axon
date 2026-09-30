import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createObject,
  emptyDocument,
  parseDocument,
  serializeDocument,
  type Connector,
} from "../src/model/document";
import { addTopic, layoutTopics } from "../src/model/mindmap";
import { fitText, registerFonts } from "../src/rendering/text";
import { primitives, type PathPrimitive } from "../src/rendering/primitives";
import { Editor } from "../src/editor/store";
import { defaults } from "../src/shared/contracts";
import { documentName } from "../src/shared/documentName";
import { FileWorkspace } from "../electron/workspace";
import { visibleSelection, placeProperties } from "../src/ui/placement";
import { exportScene } from "../src/io/export";
beforeAll(() => {
  const font = (n: string) =>
    new Uint8Array(readFileSync(`public/fonts/${n}.ttf`)).buffer;
  registerFonts(font("NotoSans-Regular"), font("NotoSansMono-Regular"));
});
describe("connection and workspace corrections", () => {
  it("uses an 8 by 6 filled head at the model endpoint and preserves unusual widths", () => {
    const doc = emptyDocument(),
      c = createObject(
        "connector",
        { x: 0, y: 0 },
        doc.background,
      ) as Connector;
    c.route = "straight";
    c.end = { type: "free", x: 100, y: 0 };
    doc.objects = [c];
    const [line, head] = primitives(c, doc, false, 1) as PathPrimitive[];
    expect(line.width).toBe(2);
    expect(line.d).toBe("M0,0 L93,0");
    expect(head.d).toBe("M100,0L92,3L92,-3Z");
    expect(head.width).toBe(0);
    expect(head.fill).toBe(c.style.stroke);
    c.style.strokeWidth = 12;
    expect(
      parseDocument(serializeDocument(doc)).objects[0].style.strokeWidth,
    ).toBe(12);
    const editor = new Editor();
    editor.set({
      prefs: {
        ...defaults,
        styles: { connector: c.style, stroke: { ...c.style, strokeWidth: 24 } },
      },
    });
    expect(editor.newObject("connector", c).style.strokeWidth).toBe(12);
    expect(editor.newObject("stroke", c).style.strokeWidth).toBe(24);
  });
  it("uses a thin node-handle connection even with a saved thick drawing style", () => {
    const editor = new Editor();
    const legacy = createObject("connector", { x: 0, y: 0 }, "#181C22");
    legacy.style = { ...legacy.style, strokeWidth: 12, stroke: "#EDB2AE", dash: true };
    const prefs = {
      ...defaults,
      styles: { connector: legacy.style },
      connector: { ...defaults.connector, route: "curved" as const, endMarker: "diamond" as const },
    };
    editor.set({ prefs, doc: { ...emptyDocument(), objects: [legacy] } });
    for (const zoom of [0.25, 0.5, 1, 2]) {
      editor.set({ camera: { x: 0, y: 0, zoom } });
      const link = editor.nodeConnection({ x: 10, y: 20 });
      expect(link.style).toEqual({ ...legacy.style, strokeWidth: 2 });
      expect(link).toMatchObject({ route: "curved", endMarker: "diamond" });
    }
    expect(editor.newObject("connector", legacy).style.strokeWidth).toBe(12);
    expect(editor.state.doc.objects[0].style.strokeWidth).toBe(12);
    expect(editor.state.prefs).toEqual(prefs);
  });
  it.each([0.1, 0.25, 0.5, 1, 2, 4])(
    "limits short heads and keeps canonical exports at zoom %s",
    (zoom) => {
      const doc = emptyDocument(),
        c = createObject(
          "connector",
          { x: 0, y: 0 },
          doc.background,
        ) as Connector;
      c.route = "straight";
      c.arrows = "both";
      c.end = { type: "free", x: 12, y: 0 };
      doc.objects = [c];
      const before = serializeDocument(doc),
        exported = exportScene(doc, [], {
          format: "svg",
          scope: "all",
          scale: 1,
          transparent: false,
        });
      const [line, head] = primitives(c, doc, false, zoom) as PathPrimitive[];
      expect(line.width * zoom).toBeCloseTo(Math.max(0.85, 2 * zoom));
      expect(head.d).toContain("9.36"); // each head is limited to 22% of the short line
      expect(serializeDocument(doc)).toBe(before);
      expect(
        exportScene(doc, [], {
          format: "svg",
          scope: "all",
          scale: 1,
          transparent: false,
        }),
      ).toEqual(exported);
    },
  );
  it("opens without fitting content and retains independent saved cameras", () => {
    const w = new FileWorkspace(),
      a = w.add(),
      b = w.add(),
      c = w.add();
    expect([a, b, c].map(documentName)).toEqual([
      "Без названия",
      "Без названия 2",
      "Без названия 3",
    ]);
    a.document.objects = [
      createObject("shape", { x: 9999, y: 9999 }, a.document.background),
    ];
    b.view = { camera: { x: -90, y: 25, zoom: 0.25 }, selection: [] };
    const e = new Editor();
    e.load({ ...a, tabs: [a, b, c], preferences: defaults, recents: [] });
    expect(e.state.camera.zoom).toBe(1);
    e.activate(b.sessionId);
    expect(e.state.camera).toEqual(b.view.camera);
    e.zoom(2);
    e.activate(a.sessionId);
    e.activate(b.sessionId);
    expect(e.state.camera.zoom).toBe(2);
    a.path = "C:\\plans\\Actual.axon";
    expect(documentName(a)).toBe("Actual.axon");
  });
  it("hides fully offscreen selections and anchors partly visible ones above the dock", () => {
    const viewport = { w: 800, h: 600 };
    expect(
      visibleSelection({ x: -300, y: 30, w: 100, h: 20 }, viewport),
    ).toBeNull();
    expect(
      visibleSelection({ x: -40, y: 30, w: 100, h: 20 }, viewport),
    ).toEqual({ x: 0, y: 30, w: 60, h: 20 });
    const p = placeProperties(null, { w: 400, h: 44 }, viewport);
    expect(p).toEqual({ x: 200, y: 476 });
  });
});
describe("text mind map", () => {
  it("inherits direction from explicit branches and does not touch other maps or the opposite side", () => {
    const root = addTopic(emptyDocument(), { x: 400, y: 300 })!;
    const left = addTopic(root.doc, root.node, root.node.id, "left")!;
    const right = addTopic(left.doc, root.node, root.node.id, "right")!;
    const leaf = addTopic(right.doc, left.node, left.node.id)!;
    expect(leaf.node.mind!.side).toBe("left");
    expect(leaf.node.x + leaf.node.w).toBeLessThan(left.node.x);
    const other = addTopic(leaf.doc, { x: 1000, y: 900 })!;
    const changed = {
      ...other.doc,
      objects: other.doc.objects.map((o) =>
        o.id === leaf.node.id
          ? fitText({ ...leaf.node, text: "Длинная тема ".repeat(12) })
          : o,
      ),
    };
    const next = layoutTopics(changed, leaf.node.id);
    expect(next.objects.find((o) => o.id === right.node.id)).toEqual(
      other.doc.objects.find((o) => o.id === right.node.id),
    );
    expect(next.objects.find((o) => o.id === other.node.id)).toBe(other.node);
    expect(parseDocument(serializeDocument(next))).toEqual(next);
    expect(leaf.node.w).toBeLessThan(50);
    expect(leaf.node.style).toMatchObject({
      fill: "none",
      strokeWidth: 0,
      fontSize: 18,
    });
  });
  it("only changes the edited node during typing and reflows on commit with one text undo", () => {
    const root = addTopic(emptyDocument(), { x: 0, y: 0 })!,
      child = addTopic(root.doc, root.node, root.node.id)!;
    const e = new Editor();
    e.set({ doc: child.doc });
    e.select([root.node.id]);
    expect(e.state.selection).toEqual([root.node.id]);
    e.beginText(root.node.id);
    e.updateText("Очень длинная центральная тема");
    expect(e.state.doc.objects.find((o) => o.id === child.node.id)).toBe(
      child.node,
    );
    e.endText();
    expect(
      e.state.doc.objects.find((o) => o.id === child.node.id)!.x,
    ).toBeGreaterThan(child.node.x);
    e.undo();
    expect(e.state.doc).toEqual(child.doc);
    expect(e.history.canUndo).toBe(false);
  });
  it("retains legacy cards without guessing missing parentage and rejects invalid v3 parent IDs", () => {
    const doc = emptyDocument();
    doc.version = 2;
    const card = createObject("shape", { x: 5, y: 5 }, doc.background);
    doc.objects = [card];
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    const map = addTopic(doc, { x: 500, y: 500 })!;
    map.node.mind!.parentId = "missing";
    expect(() => parseDocument(map.doc)).toThrow();
  });
});
