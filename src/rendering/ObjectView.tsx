import { memo, useMemo } from "react";
import type { AxonDocument, AxonObject } from "../model/document";
import { primitives, labelArea } from "./primitives";
import { layoutText } from "./text";
import { isTextTopic } from "../model/document";
import { connectorPath } from "../model/geometry";
import { objectRenderDocument } from "./dependencies";
type Props = { object: AxonObject; doc: AxonDocument; zoom: number };
export function ObjectView({ object, doc, zoom }: Props) {
  return <ObjectBody object={object} doc={objectRenderDocument(object, doc)} zoom={zoom} />;
}
const ObjectBody = memo(
  function ObjectView({
    object: o,
    doc,
    zoom,
  }: Props) {
    const connectionDoc = o.type === "connector" ? doc : undefined;
    const ps = useMemo(
      () => primitives(o, doc, false, zoom),
      [o, connectionDoc, doc.background, doc.assets, zoom],
    );
    const lines = useMemo(
      () =>
        "text" in o && o.text
          ? layoutText(
              o.text,
              labelArea(o, doc),
              o.style,
              o.type === "sticky" || o.type === "text",
            )
          : [],
      [o, connectionDoc],
    );
    return (
      <g
        data-object-id={o.id}
        aria-label={"text" in o ? o.text || o.type : o.type}
      >
        {(o.type === "text" || isTextTopic(o)) && (
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" />
        )}
        {ps.map((p, i) =>
          p.type === "image" ? (
            <image
              key={i}
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              href={p.href}
              preserveAspectRatio="none"
            />
          ) : (
            <g key={i}>
              {(o.type === "connector" || o.type === "stroke") && i === 0 && (
                <path
                  d={o.type === "connector" ? connectorPath(o, doc) : p.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(p.width, 12 / zoom)}
                  pointerEvents="stroke"
                />
              )}
              <path
                d={p.d}
                fill={
                  p.fill === "none" && o.type === "shape" && i === 0
                    ? "transparent"
                    : p.fill
                }
                stroke={p.stroke}
                strokeWidth={p.width}
                strokeDasharray={p.dash ? "8 6" : undefined}
                strokeLinecap={p.cap ?? "round"}
                strokeLinejoin="round"
              />
            </g>
          ),
        )}
        {lines.map((line, i) => (
          <text
            key={`text-${i}`}
            x={line.x}
            y={line.y}
            fill={o.style.color}
            fontSize={o.style.fontSize}
            fontFamily={o.style.font === "mono" ? "Axon Mono" : "Axon Sans"}
            style={{ whiteSpace: "pre", fontKerning: "normal" }}
          >
            {line.text}
          </text>
        ))}
      </g>
    );
  },
  (a, b) =>
    a.object === b.object &&
    (a.zoom === b.zoom || !["connector", "stroke"].includes(a.object.type)) &&
    a.doc === b.doc,
);
