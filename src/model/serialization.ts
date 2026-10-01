import type { AxonDocument, AxonObject, Endpoint, Style } from "./document";

function styleDTO(style: Style): Style {
  return {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    dash: style.dash,
    radius: style.radius,
    color: style.color,
    fontSize: style.fontSize,
    padding: style.padding,
    font: style.font,
    align: style.align,
  };
}

function endpointDTO(endpoint: Endpoint): Endpoint {
  return endpoint.type === "bound"
    ? { type: endpoint.type, nodeId: endpoint.nodeId, side: endpoint.side }
    : { type: endpoint.type, x: endpoint.x, y: endpoint.y };
}

function objectDTO(object: AxonObject): AxonObject {
  const base = {
    id: object.id,
    x: object.x,
    y: object.y,
    w: object.w,
    h: object.h,
    locked: object.locked,
    groupId: object.groupId,
    style: styleDTO(object.style),
  };
  switch (object.type) {
    case "shape":
      return {
        ...base,
        type: object.type,
        shape: object.shape,
        mind: object.mind && {
          treeId: object.mind.treeId,
          parentId: object.mind.parentId,
          order: object.mind.order,
          side: object.mind.side,
          presentation: object.mind.presentation,
        },
        text: object.text,
      };
    case "sticky":
    case "text":
      return { ...base, type: object.type, text: object.text };
    case "image":
      return { ...base, type: object.type, assetId: object.assetId };
    case "stroke":
      return {
        ...base,
        type: object.type,
        points: object.points.map(({ x, y }) => ({ x, y })),
      };
    case "connector":
      return {
        ...base,
        type: object.type,
        start: endpointDTO(object.start),
        end: endpointDTO(object.end),
        route: object.route,
        mindBranch: object.mindBranch,
        arrows: object.arrows,
        startMarker: object.startMarker,
        endMarker: object.endMarker,
        text: object.text,
      };
  }
}

/**
 * Serialize a snapshot already accepted at an input boundary or produced by
 * model operations. This projection is not runtime validation: IPC, files,
 * recovery and external clipboard data must still pass parseDocument first.
 * Explicit fields preserve the existing schema's key order and omit UI state.
 */
export function serializePreparedDocument(doc: AxonDocument): string {
  return JSON.stringify({
    format: doc.format,
    version: doc.version,
    id: doc.id,
    title: doc.title,
    background: doc.background,
    objects: doc.objects.map(objectDTO),
    assets: Object.fromEntries(
      Object.entries(doc.assets).map(([key, asset]) => [key, {
        id: asset.id,
        mime: asset.mime,
        data: asset.data,
        width: asset.width,
        height: asset.height,
      }]),
    ),
  });
}
