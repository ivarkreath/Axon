import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, LockKeyhole } from "lucide-react";
import { editor, useEditor } from "../editor/store";
import { ColorPicker } from "./ColorPicker";
import { VisualPicker } from "./VisualPicker";
import {
  lineOptions,
  routeOptions,
  markerOptions,
  cornerOptions,
  alignOptions,
} from "./propertyIcons";
import { PropertyPopover, returnEditorFocus } from "./PropertyPopover";
import {
  SHAPE_STROKE_WIDTH,
  connectorMarkers,
  type AxonObject,
  type Style,
} from "../model/document";
import { objectBounds, union, worldToScreen } from "../model/geometry";
import { expandSelection } from "../model/operations";
import { labelArea } from "../rendering/primitives";
import { placeProperties, visibleSelection } from "./placement";
export function Inspector() {
  const s = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 400, h: 44 });
  const objects = s.doc.objects.filter((o) => s.selection.includes(o.id));
  const tool = !s.editing && !["select", "hand"].includes(s.tool);
  const targets = tool
    ? [editor.newObject(s.tool as AxonObject["type"], { x: 0, y: 0 })]
    : objects;
  const box = union(objects.map((o) => objectBounds(o, s.doc)));
  const screenBox = box
    ? {
        ...worldToScreen(box, s.camera),
        w: box.w * s.camera.zoom,
        h: box.h * s.camera.zoom,
      }
    : null;
  const visible =
    targets.length > 0 &&
    !s.interacting &&
    (tool ||
      (s.tool === "select" &&
        screenBox &&
        visibleSelection(screenBox, s.viewport)));
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        w: entry.borderBoxSize[0].inlineSize,
        h: entry.borderBoxSize[0].blockSize,
      }),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [!!visible]);
  if (!visible) return null;
  const every = (fn: (o: AxonObject) => boolean) => targets.every(fn);
  const mixed = <K extends keyof Style>(key: K): Style[K] | "" =>
    every((o) => o.style[key] === targets[0].style[key])
      ? targets[0].style[key]
      : "";
  const mind = every((o) => o.type === "shape" && !!o.mind);
  const decoration = every((o) => !(o.type === "shape" && o.mind));
  const editing = s.doc.objects.find((o) => o.id === s.editing);
  const area = editing ? labelArea(editing, s.doc) : null;
  const avoid = area
    ? {
        ...worldToScreen(area, s.camera),
        w: area.w * s.camera.zoom,
        h: area.h * s.camera.zoom,
      }
    : screenBox;
  const position = placeProperties(
    tool ? null : screenBox,
    size,
    s.viewport,
    avoid,
  );
  const color = (key: "fill" | "stroke" | "color", label: string) => (
    <PropertyPopover
      label={label + (mixed(key) === "" ? " · Разные" : "")}
      trigger={
        <span
          className={`color-dot ${key === "stroke" ? "outline-dot" : key === "color" ? "text-color-dot" : ""} ${mixed(key) === "" ? "mixed-dot" : ""}`}
          style={
            key === "stroke"
              ? { borderColor: mixed(key) || undefined }
              : key === "color"
                ? { borderBottomColor: mixed(key) || undefined }
                : { background: mixed(key) || undefined }
          }
        >
          {key === "color" ? "A" : null}
        </span>
      }
    >
      <ColorPicker
        label={label}
        value={String(mixed(key))}
        onChange={(value) => editor.style({ [key]: value })}
        allowNone={key === "fill"}
      />
    </PropertyPopover>
  );
  const controls: {
    key: string;
    width: number;
    node: ReactNode;
    rare?: boolean;
  }[] = [];
  const add = (key: string, node: ReactNode, width = 42, rare = false) =>
    controls.push({ key, node, width, rare });
  const connection = targets[0].type === "connector" ? targets[0] : null;
  const structural = every((o) => o.type === "connector" && !!o.mindBranch);
  const connectorPatch = (patch: Partial<AxonObject>) => {
    if (tool) {
      editor.connectionDefaults(patch);
      return;
    }
    editor.formatChange((doc) => ({
      ...doc,
      objects: doc.objects.map((o) =>
        objects.some((t) => t.id === o.id) &&
        !o.locked &&
        o.type === "connector" &&
        !o.mindBranch
          ? ({ ...o, ...patch } as AxonObject)
          : o,
      ),
    }));
  };
  const select = (
    label: string,
    value: string | number,
    onChange: (value: string) => void,
    options: [string | number, string][],
    className = "",
  ) => (
    <select
      className={`compact-select ${className}`}
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Разные
      </option>
      {options.map(([v, name]) => (
        <option value={v} key={v}>
          {name}
        </option>
      ))}
    </select>
  );
  if (decoration && every((o) => ["shape", "sticky"].includes(o.type)))
    add("fill", color("fill", "Заливка"), 42, !!s.editing);
  if (decoration && every((o) => !["text", "image"].includes(o.type)))
    add("stroke", color("stroke", "Обводка"), 42, !!s.editing);
  if (
    decoration &&
    every((o) => ["shape", "sticky", "connector"].includes(o.type))
  )
    add(
      "dash",
      <VisualPicker
        label="Стиль линии"
        value={mixed("dash") === "" ? "" : mixed("dash") ? "dash" : "solid"}
        options={lineOptions(!connection)}
        onChange={(v) => editor.style({ dash: v === "dash" })}
      />,
      42,
      !!s.editing,
    );
  if (decoration && every((o) => o.type === "shape" && o.shape === "rect"))
    add(
      "radius",
      <VisualPicker
        label="Углы"
        value={String(mixed("radius"))}
        options={cornerOptions}
        onChange={(v) => editor.style({ radius: +v })}
      />,
      42,
      !!s.editing,
    );
  if (every((o) => ["connector", "stroke"].includes(o.type)))
    add(
      "width",
      select(
        "Толщина",
        mixed("strokeWidth"),
        (v) => editor.style({ strokeWidth: +v }),
        [1, 1.5, 2, 2.5, 3, 4, 6, 8, 12, 24].map((n) => [n, String(n)]),
        "width-select",
      ),
      58,
    );
  if (connection && every((o) => o.type === "connector") && !structural) {
    const route = every(
      (o) => o.type === "connector" && o.route === connection.route,
    )
      ? connection.route
      : "";
    add(
      "route",
      <VisualPicker
        label="Маршрут"
        value={route}
        options={routeOptions}
        onChange={(v) => connectorPatch({ route: v })}
      />,
    );
    for (const side of ["start", "end"] as const) {
      const current = connectorMarkers(connection)[side];
      const value = every(
        (o) => o.type === "connector" && connectorMarkers(o)[side] === current,
      )
        ? current
        : "";
      add(
        side,
        <VisualPicker
          label={side === "start" ? "Начало линии" : "Конец линии"}
          value={value}
          options={markerOptions(side)}
          onChange={(v) =>
            connectorPatch({
              [side === "start" ? "startMarker" : "endMarker"]: v,
            })
          }
        />,
      );
    }
  }
  if (
    every((o) => "text" in o) &&
    (!connection || !!s.editing || objects.some((o) => "text" in o && o.text))
  ) {
    add(
      "font",
      select(
        "Шрифт",
        mixed("font"),
        (v) => editor.style({ font: v as Style["font"] }),
        [
          ["sans", "Noto Sans"],
          ["mono", "Noto Sans Mono"],
        ],
        "font-select",
      ),
      124,
    );
    add(
      "size",
      <input
        className="font-size-input"
        aria-label="Размер текста"
        title="Размер текста"
        type="number"
        min="1"
        max="1200"
        placeholder="Разные"
        value={mixed("fontSize")}
        onChange={(e) => {
          const n = +e.target.value;
          if (n >= 1 && n <= 1200) editor.style({ fontSize: n });
        }}
      />,
      62,
    );
    add("color", color("color", "Цвет текста"));
    add(
      "align",
      <VisualPicker
        label="Выравнивание текста"
        value={mixed("align")}
        options={alignOptions}
        onChange={(v) => editor.style({ align: v })}
      />,
    );
  }
  const locked = objects.some((o) => o.locked);
  let remaining = Math.min(620, s.viewport.w - 28) - 48;
  const inline = controls.filter((c) => {
    if (locked || c.rare || remaining < c.width + 4) return false;
    remaining -= c.width + 4;
    return true;
  });
  const overflow = controls.filter((c) => !inline.includes(c));
  const action = (label: string, run: () => void) => (
    <button
      data-close-popover
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        run();
        returnEditorFocus();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      className={`context-properties panel ${tool ? "tool-properties" : ""}`}
      role="toolbar"
      aria-label={tool ? "Стиль создания" : "Свойства выделения"}
      style={{ left: position.x, top: position.y }}
    >
      {locked ? (
        <LockKeyhole size={18} aria-label="Выделение заблокировано" />
      ) : (
        inline.map((c) => (
          <div className="property-slot" key={c.key}>
            {c.node}
          </div>
        ))
      )}
      <PropertyPopover
        chevron={false}
        label="Ещё"
        trigger={<Ellipsis size={20} />}
      >
        {!locked && overflow.length > 0 && (
          <div className="overflow-properties">
            {overflow.map((c) => (
              <div className="overflow-property" key={c.key}>
                {c.node}
              </div>
            ))}
          </div>
        )}
        <div className="property-actions">
          {locked ? (
            action("Исключить заблокированные", () =>
              editor.select(
                objects
                  .filter(
                    (o) =>
                      !expandSelection(s.doc, [o.id]).some(
                        (id) => s.doc.objects.find((t) => t.id === id)?.locked,
                      ),
                  )
                  .map((o) => o.id),
              ),
            )
          ) : (
            <>
              {objects.length === 1 &&
                "text" in objects[0] &&
                action("Редактировать текст", () =>
                  editor.beginText(objects[0].id),
                )}
              {mind && objects.length === 1 && (
                <>
                  {action("Добавить подтему", () => editor.topic())}
                  {action("Добавить тему рядом", () => editor.topic(true))}
                </>
              )}
              {every((o) => o.type === "sticky") &&
                action("Переключить рамку", () =>
                  editor.style({
                    strokeWidth: targets.every((o) => o.style.strokeWidth > 0)
                      ? 0
                      : SHAPE_STROKE_WIDTH,
                  }),
                )}
              {objects.length === 1 &&
                !structural &&
                action("Использовать стиль для новых", () =>
                  editor.useStyleForNew(),
                )}
              {action("Системный стиль", () => editor.resetStyle())}
              {!!objects.length && (
                <>
                  {action("Дублировать", () => editor.duplicate())}
                  {action("Заблокировать", () => editor.lock())}
                  {action("Удалить", () => editor.remove())}
                </>
              )}
              {objects.length > 1 && (
                <>
                  {action(
                    objects.some((o) => o.groupId)
                      ? "Разгруппировать"
                      : "Сгруппировать",
                    () => editor.group(objects.some((o) => o.groupId)),
                  )}
                  {(
                    [
                      ["left", "По левому краю"],
                      ["centerX", "По центру горизонтально"],
                      ["right", "По правому краю"],
                      ["top", "По верхнему краю"],
                      ["centerY", "По центру вертикально"],
                      ["bottom", "По нижнему краю"],
                      ["distributeX", "Распределить горизонтально"],
                      ["distributeY", "Распределить вертикально"],
                    ] as const
                  ).map(([mode, label]) => (
                    <div key={mode}>
                      {action(label, () => editor.align(mode))}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </PropertyPopover>
    </div>
  );
}
