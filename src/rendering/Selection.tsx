import { isLight, isTextTopic, type AxonDocument } from "../model/document";
import { endpoint, objectBounds, union } from "../model/geometry";
export function Selection({
  doc,
  ids,
  zoom,
  showEndpoints = true,
}: {
  doc: AxonDocument;
  ids: string[];
  zoom: number;
  showEndpoints?: boolean;
}) {
  const objects = doc.objects.filter((o) => ids.includes(o.id));
  const box = union(objects.map((o) => objectBounds(o, doc)));
  if (!box) return null;
  const o = objects.length === 1 ? objects[0] : null;
  const handles = [
    ["nw", 0, 0],
    ["n", 0.5, 0],
    ["ne", 1, 0],
    ["e", 1, 0.5],
    ["se", 1, 1],
    ["s", 0.5, 1],
    ["sw", 0, 1],
    ["w", 0, 0.5],
  ] as const;
  const size = 9 / zoom;
  const accent = isLight(doc.background) ? "#146CA4" : "#75C8FF";
  return (
    <g className="selection" stroke={accent} strokeWidth={1.5 / zoom}>
      {objects.map((o) => {
        if (o.type === "connector") return null;
        const b = objectBounds(o, doc);
        return (
          <rect
            key={o.id}
            x={b.x - 3 / zoom}
            y={b.y - 3 / zoom}
            width={b.w + 6 / zoom}
            height={b.h + 6 / zoom}
            fill="none"
            strokeDasharray={
              objects.length > 1 ? `${4 / zoom} ${4 / zoom}` : undefined
            }
            pointerEvents="none"
          />
        );
      })}
      {objects.length > 1 && (
        <rect
          x={box.x - 6 / zoom}
          y={box.y - 6 / zoom}
          width={box.w + 12 / zoom}
          height={box.h + 12 / zoom}
          fill="none"
          pointerEvents="none"
        />
      )}
      {objects.length > 1 &&
        !objects.some((o) => o.locked) &&
        handles
          .filter(([name]) => name.length === 2)
          .map(([name, dx, dy]) => (
            <rect
              key={name}
              data-scale="true"
              data-handle={name}
              x={box.x + box.w * dx - size / 2}
              y={box.y + box.h * dy - size / 2}
              width={size}
              height={size}
              fill="#152531"
              style={{ cursor: `${name}-resize` }}
            />
          ))}
      {o &&
        !isTextTopic(o) &&
        !o.locked &&
        !o.groupId &&
        ["shape", "sticky", "image", "text"].includes(o.type) &&
        handles
          .filter(([name]) => o.type !== "image" || name.length === 2)
          .map(([name, dx, dy]) => (
            <rect
              key={name}
              data-object-id={o.id}
              data-handle={name}
              x={box.x + box.w * dx - size / 2}
              y={box.y + box.h * dy - size / 2}
              width={size}
              height={size}
              fill="#152531"
              style={{ cursor: `${name}-resize` }}
            />
          ))}
      {o?.type === "connector" &&
        showEndpoints &&
        !o.mindBranch &&
        !o.locked &&
        !o.groupId &&
        (["start", "end"] as const).map((key) => {
          const p = endpoint(o[key], doc);
          return (
            <rect
              key={key}
              data-object-id={o.id}
              data-end={key}
              x={p.x - size / 2}
              y={p.y - size / 2}
              width={size}
              height={size}
              fill={o[key].type === "bound" ? "#75C8FF" : "#152531"}
              style={{ cursor: "crosshair" }}
            />
          );
        })}
    </g>
  );
}
