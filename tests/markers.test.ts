import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  connectorMarkers,
  createObject,
  emptyDocument,
  markerSchema,
  parseDocument,
  serializeDocument,
  type Connector,
} from "../src/model/document";
import { connectionHeads, curveControls, endpoint, objectBounds, route as routePoints } from "../src/model/geometry";
import {
  contentBounds,
  primitives,
  type PathPrimitive,
} from "../src/rendering/primitives";
import { registerFonts } from "../src/rendering/text";
import { Editor } from "../src/editor/store";
import { preferencesSchema, defaults } from "../src/shared/contracts";
const fixture = () => {
  const doc = emptyDocument(),
    c = createObject("connector", { x: 0, y: 0 }, doc.background) as Connector;
  c.route = "straight";
  doc.objects = [c];
  return { doc, c };
};
beforeAll(() => {
  const font = (n: string) =>
    new Uint8Array(readFileSync(`public/fonts/${n}.ttf`)).buffer;
  registerFonts(font("NotoSans-Regular"), font("NotoSansMono-Regular"));
});
describe("independent connection endings", () => {
  it.each(["none", "end", "both"] as const)(
    "preserves legacy %s without injecting fields on load",
    (arrows) => {
      const { doc, c } = fixture();
      for (const version of [1, 2, 3] as const) {
        doc.version = version;
        c.arrows = arrows;
        const loaded = parseDocument(serializeDocument(doc));
        expect(loaded).toEqual(doc);
        expect(connectorMarkers(loaded.objects[0] as Connector)).toEqual({
          start: arrows === "both" ? "arrow" : "none",
          end: arrows === "none" ? "none" : "arrow",
        });
        expect(primitives(loaded.objects[0], loaded, false)).toEqual(
          primitives(c, doc, false),
        );
      }
      expect(
        preferencesSchema.parse({
          ...defaults,
          connector: { route: "straight", arrows },
        }).connector,
      ).toEqual({ route: "straight", arrows });
    },
  );
  it.each(markerSchema.options)(
    "serializes %s at either end and rejects unknown endings",
    (marker) => {
      const { doc, c } = fixture();
      c.startMarker = marker;
      c.endMarker = marker;
      expect(parseDocument(serializeDocument(doc))).toEqual(doc);
      expect(() =>
        parseDocument({
          ...doc,
          objects: [{ ...c, endMarker: "unsupported" }],
        }),
      ).toThrow();
    },
  );
  it.each(["straight", "orthogonal", "curved"] as const)(
    "orients %s endings along the endpoint tangents and includes them in bounds",
    (route) => {
      for (const end of [
        { x: 100, y: 0 },
        { x: -100, y: 0 },
        { x: 0, y: 100 },
        { x: 0, y: -100 },
        { x: -100, y: 75 },
      ])
        for (const marker of markerSchema.options) {
          const { doc, c } = fixture();
          c.route = route;
          c.end = { type: "free", ...end };
          c.startMarker = marker;
          c.endMarker = marker;
          const heads = connectionHeads(c, doc),
            box = objectBounds(c, doc),
            exported = contentBounds(doc)!;
          for (const side of ["start", "end"] as const) {
            const head = heads[side];
            if (!head) {
              expect(marker).toBe("none");
              continue;
            }
          const tip = endpoint(c[side], doc);
          expect(head.d).toContain(`${tip.x},${tip.y}`);
          const samples = routePoints(c, doc).filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
          const controls = c.route === "curved" ? curveControls(c, doc) : null;
          const from = side === "start" ? controls?.[0] ?? samples[1] : controls?.[1] ?? samples.at(-2)!;
          const center = { x: head.bounds.x + head.bounds.w / 2, y: head.bounds.y + head.bounds.h / 2 };
          expect((center.x - tip.x) * (tip.x - from.x) + (center.y - tip.y) * (tip.y - from.y)).toBeLessThan(0);
            for (const bounds of [box, exported]) {
              expect(bounds.x).toBeLessThanOrEqual(head.bounds.x);
              expect(bounds.y).toBeLessThanOrEqual(head.bounds.y);
              expect(bounds.x + bounds.w + 1e-9).toBeGreaterThanOrEqual(
                head.bounds.x + head.bounds.w,
              );
              expect(bounds.y + bounds.h + 1e-9).toBeGreaterThanOrEqual(
                head.bounds.y + head.bounds.h,
              );
            }
          }
          if (route === "straight" && heads.end) {
            const b = heads.end.bounds,
              center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            expect(
              (center.x - end.x) * end.x + (center.y - end.y) * end.y,
            ).toBeLessThan(0);
          }
          const stored = serializeDocument(doc),
            canonical = primitives(c, doc, false);
          for (const zoom of [0.25, 0.5, 1, 2])
            expect(
              (primitives(c, doc, false, zoom)[0] as PathPrimitive).width *
                zoom,
            ).toBeGreaterThanOrEqual(0.85);
          expect(primitives(c, doc, false)).toEqual(canonical);
          expect(serializeDocument(doc)).toBe(stored);
        }
    },
  );
  it("keeps endpoint identity, defaults and one history step per property choice, including while typing", () => {
    const { doc, c } = fixture(),
      editor = new Editor();
    editor.set({ doc });
    editor.select([c.id]);
    editor.formatChange((d) => ({
      ...d,
      objects: [{ ...c, startMarker: "circle" }],
    }));
    expect(editor.state.prefs).toEqual(defaults);
    const changed = editor.state.doc;
    expect((changed.objects[0] as Connector).start).toBe(c.start);
    editor.undo();
    expect(editor.state.doc).toEqual(doc);
    expect(editor.history.canUndo).toBe(false);
    editor.redo();
    expect(editor.state.doc).toEqual(changed);
    editor.beginText(c.id);
    editor.updateText("Подпись");
    editor.style({ dash: true });
    expect(editor.state.editing).toBe(c.id);
    editor.endText();
    editor.undo();
    expect(editor.state.doc.objects[0].style.dash).toBe(false);
    expect((editor.state.doc.objects[0] as Connector).text).toBe("Подпись");
    editor.undo();
    expect((editor.state.doc.objects[0] as Connector).text).toBe("");
  });
});
