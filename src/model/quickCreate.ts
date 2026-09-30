import {
  SHAPE_STROKE_WIDTH,
  uid,
  type AxonDocument,
  type AxonObject,
  type Connector,
  type Endpoint,
} from "./document";
import { intersects } from "./geometry";
export type Side = Extract<Endpoint, { type: "bound" }>["side"];
export const opposite: Record<Side, Side> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};
export function nextObject(
  doc: AxonDocument,
  source: AxonObject,
  side: Side,
): AxonObject {
  if (source.type !== "shape" && source.type !== "sticky")
    throw new Error("Недопустимый источник");
  const node = {
    ...source,
    id: uid(),
    text: "",
    locked: false,
    style: {
      ...source.style,
      strokeWidth:
        source.type === "shape"
          ? SHAPE_STROKE_WIDTH
          : source.style.strokeWidth === 0
            ? 0
            : SHAPE_STROKE_WIDTH,
    },
  };
  delete node.groupId;
  if (node.type === "shape") delete node.mind;
  const dx =
    side === "right" ? source.w + 80 : side === "left" ? -source.w - 80 : 0;
  const dy =
    side === "bottom" ? source.h + 60 : side === "top" ? -source.h - 60 : 0;
  node.x += dx;
  node.y += dy;
  // Scan the perpendicular lane without moving any existing objects.
  while (
    doc.objects.some(
      (o) =>
        o.type !== "connector" &&
        intersects(
          { x: node.x - 16, y: node.y - 16, w: node.w + 32, h: node.h + 32 },
          o,
        ),
    )
  ) {
    if (dx) node.y += node.h + 40;
    else node.x += node.w + 40;
  }
  return node;
}
export function quickCreate(
  doc: AxonDocument,
  source: AxonObject,
  side: Side,
  connection: Connector,
) {
  const node = nextObject(doc, source, side);
  const arrow: Connector = {
    ...connection,
    start: { type: "bound", nodeId: source.id, side },
    end: { type: "bound", nodeId: node.id, side: opposite[side] },
  };
  return { doc: { ...doc, objects: [...doc.objects, node, arrow] }, node };
}
