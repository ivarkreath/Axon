import type { AxonDocument, AxonObject, Asset } from "../model/document";
import { getDocumentIndex } from "../model/indices";

type Entry = {
  background: string;
  start?: AxonObject;
  end?: AxonObject;
  asset?: Asset;
  document: AxonDocument;
};
// A single projection per live immutable object, with no reference to the full
// scene or its unrelated assets. Closed scenes can be collected normally.
const documents = new WeakMap<AxonObject, Entry>();

export function objectRenderDocument(object: AxonObject, document: AxonDocument) {
  const byId = object.type === "connector" ? getDocumentIndex(document).byId : undefined;
  const start = object.type === "connector" && object.start.type === "bound"
    ? byId?.get(object.start.nodeId) : undefined;
  const end = object.type === "connector" && object.end.type === "bound"
    ? byId?.get(object.end.nodeId) : undefined;
  const asset = object.type === "image" ? document.assets[object.assetId] : undefined;
  const previous = documents.get(object);
  if (previous && previous.background === document.background &&
    previous.start === start && previous.end === end && previous.asset === asset)
    return previous.document;
  const projection: AxonDocument = {
    format: document.format, version: document.version, id: document.id,
    title: document.title, background: document.background,
    objects: [object, ...(start ? [start] : []), ...(end && end !== start ? [end] : [])],
    assets: asset ? { [asset.id]: asset } : {},
  };
  documents.set(object, { background: document.background, start, end, asset, document: projection });
  return projection;
}
