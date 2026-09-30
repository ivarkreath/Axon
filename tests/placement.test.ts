import { describe, expect, it } from "vitest";
import { placeProperties } from "../src/ui/placement";
import { intersects } from "../src/model/geometry";
describe("context panel placement", () => {
  it("does not cover endpoint handles of a zero-height horizontal connector", () => {
    const box = { x: 500, y: 160, w: 350, h: 0 },
      size = { w: 580, h: 140 };
    const p = placeProperties(box, size, { w: 1366, h: 678 });
    expect(intersects({ ...p, ...size }, { ...box, y: 150, h: 20 })).toBe(
      false,
    );
  });
  it.each([
    { x: 0, y: 0, w: 180, h: 100 },
    { x: 1200, y: 640, w: 180, h: 100 },
    { x: -130, y: 320, w: 180, h: 100 },
    { x: 450, y: 0, w: 180, h: 100 },
    { x: 400, y: 550, w: 180, h: 100 },
  ])("keeps controls inside the viewport at $x/$y", (box) => {
    const size = { w: 620, h: 170 },
      viewport = { w: 1366, h: 678 };
    const p = placeProperties(box, size, viewport);
    expect(p.x).toBeGreaterThanOrEqual(12);
    expect(p.y).toBeGreaterThanOrEqual(14);
    expect(p.x + size.w).toBeLessThanOrEqual(viewport.w - 12);
    expect(p.y + size.h).toBeLessThanOrEqual(viewport.h - 64);
  });
  it("chooses the side when top/bottom would cover active text", () => {
    const box = { x: 50, y: 0, w: 250, h: 670 },
      size = { w: 620, h: 170 };
    const position = placeProperties(box, size, { w: 1366, h: 678 });
    expect(intersects({ ...position, ...size }, box)).toBe(false);
  });
});
