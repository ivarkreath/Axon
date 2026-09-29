import { memo, useMemo } from "react";
import type { AxonDocument, AxonObject } from "../model/document";
import { primitives, labelArea } from "./primitives";
import { layoutText } from "./text";
export const ObjectView = memo(
  function ObjectView({
    object: o,
    doc,
    zoom,
  }: {
    object: AxonObject;
    doc: AxonDocument;
    zoom: number;
  }) {
    const connectionDoc = o.type === "connector" ? doc : undefined;
    const ps = useMemo(
      () => primitives(o, doc, false),
      [o, connectionDoc, doc.background, doc.assets],
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
        {o.type === "text" && (
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
                  d={p.d}
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
                strokeLinecap="round"
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
    (a.object.type === "connector"
      ? a.doc === b.doc
      : a.doc.background === b.doc.background && a.doc.assets === b.doc.assets),
);
