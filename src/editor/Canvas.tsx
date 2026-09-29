import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import { useGestures } from "./useGestures";
import {
  anchor,
  screenToWorld,
  sides,
  worldToScreen,
  zoomAt,
} from "../model/geometry";
import { ObjectView } from "../rendering/ObjectView";
import { Selection } from "../rendering/Selection";
import { labelArea } from "../rendering/primitives";
import { isLight } from "../model/document";
export function Canvas({
  onContext,
  error,
}: {
  onContext: (x: number, y: number) => void;
  error: (message: string) => void;
}) {
  const s = useEditor();
  const root = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    space = useRef(false);
  const [panning, setPanning] = useState(false);
  const gestures = useGestures(space);
  const text = useRef<HTMLTextAreaElement>(null);
  const lastHit = useRef<string | null>(null);
  const editing = s.doc.objects.find((o) => o.id === s.editing);
  const area = editing ? labelArea(editing, s.doc) : null;
  const textPosition = area ? worldToScreen(area, s.camera) : null;
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      editor.set({ viewport: { w: width, h: height } });
    });
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        c = editor.state.camera;
      if (e.ctrlKey || e.metaKey)
        editor.set({
          camera: zoomAt(
            c,
            { x: e.clientX - r.left, y: e.clientY - r.top },
            c.zoom * Math.exp(-e.deltaY * 0.006),
          ),
        });
      else
        editor.set({ camera: { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY } });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
        setPanning(true);
      }
      if (e.key === "Escape") {
        gestures.cancel();
        editor.set({ selection: [], tool: "select" });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        setPanning(false);
      }
    };
    const blur = () => {
      space.current = false;
      setPanning(false);
      gestures.cancel();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });
  useEffect(() => {
    if (s.editing) {
      text.current?.focus();
      text.current?.select();
    }
  }, [s.editing]);
  async function drop(e: React.DragEvent) {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    for (const file of files) {
      if (!["image/png", "image/jpeg"].includes(file.type)) {
        error("Можно вставить только PNG или JPEG.");
        continue;
      }
      try {
        if (file.size > 20e6) throw new Error("Изображение больше 20 МБ.");
        const asset = await window.axon.decodeImage(
          new Uint8Array(await file.arrayBuffer()),
          file.type,
        );
        const r = root.current!.getBoundingClientRect();
        editor.addImage(
          asset,
          screenToWorld(
            { x: e.clientX - r.left, y: e.clientY - r.top },
            editor.state.camera,
          ),
        );
      } catch (err) {
        error(String(err));
      }
    }
  }
  const gridColor = isLight(s.doc.background) ? "#293F592A" : "#B9D1E22A";
  const canvasAccent = isLight(s.doc.background) ? "#146CA4" : "#75C8FF";
  const gridSize = 20 * s.camera.zoom;
  const activeConnector =
    s.tool === "connector" ||
    s.doc.objects.some(
      (o) => s.selection.includes(o.id) && o.type === "connector",
    );
  return (
    <div
      className="canvas-wrap"
      ref={root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drop}
    >
      <svg
        ref={svg}
        className="canvas"
        aria-label="Холст Axon"
        style={{
          background: s.doc.background,
          cursor:
            panning || s.tool === "hand"
              ? "grab"
              : s.tool === "select"
                ? "default"
                : "crosshair",
        }}
        onPointerDown={(e) => {
          lastHit.current =
            (e.target as Element)
              .closest("[data-object-id]")
              ?.getAttribute("data-object-id") ?? null;
          gestures.onPointerDown(e);
        }}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
        onContextMenu={(e) => {
          e.preventDefault();
          const id = (e.target as Element)
            .closest("[data-object-id]")
            ?.getAttribute("data-object-id");
          if (id && !s.selection.includes(id)) editor.select([id]);
          onContext(e.clientX, e.clientY);
        }}
        onDoubleClick={() => {
          if (lastHit.current) editor.beginText(lastHit.current);
        }}
      >
        <defs>
          <pattern
            id="grid"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
            x={s.camera.x % gridSize}
            y={s.camera.y % gridSize}
          >
            {s.prefs.grid === "dots" ? (
              <circle cx={1} cy={1} r={0.8} fill={gridColor} />
            ) : (
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke={gridColor}
                strokeWidth=".65"
              />
            )}
          </pattern>
        </defs>
        {s.prefs.grid !== "none" && s.camera.zoom > 0.2 && (
          <rect width="100%" height="100%" fill="url(#grid)" />
        )}
        <g
          transform={`translate(${s.camera.x},${s.camera.y}) scale(${s.camera.zoom})`}
        >
          {s.doc.objects.map((o) => (
            <ObjectView
              key={o.id}
              object={o}
              doc={s.doc}
              zoom={s.camera.zoom}
            />
          ))}
          {!s.editing && (
            <Selection doc={s.doc} ids={s.selection} zoom={s.camera.zoom} />
          )}
          {activeConnector &&
            s.doc.objects
              .filter((o) => o.type === "shape" || o.type === "sticky")
              .flatMap((o) =>
                sides.map((side) => {
                  const p = anchor(o, side);
                  return (
                    <circle
                      key={o.id + side}
                      cx={p.x}
                      cy={p.y}
                      r={4 / s.camera.zoom}
                      fill="#153044"
                      stroke={canvasAccent}
                      strokeWidth={1.5 / s.camera.zoom}
                      pointerEvents="none"
                    />
                  );
                }),
              )}
          {s.marquee && (
            <rect
              {...{
                x: s.marquee.x,
                y: s.marquee.y,
                width: s.marquee.w,
                height: s.marquee.h,
              }}
              fill="#70C8FF18"
              stroke={canvasAccent}
              strokeWidth={1 / s.camera.zoom}
              pointerEvents="none"
            />
          )}
          {s.guides.map((g, i) => (
            <line
              key={i}
              x1={g.axis === "x" ? g.value : -1e6}
              x2={g.axis === "x" ? g.value : 1e6}
              y1={g.axis === "y" ? g.value : -1e6}
              y2={g.axis === "y" ? g.value : 1e6}
              stroke={canvasAccent}
              strokeWidth={1 / s.camera.zoom}
              strokeDasharray={`${4 / s.camera.zoom} ${4 / s.camera.zoom}`}
              pointerEvents="none"
            />
          ))}
        </g>
      </svg>
      {!s.doc.objects.length && (
        <div
          className={`empty-hint ${isLight(s.doc.background) ? "light-canvas" : "dark-canvas"}`}
        >
          <div className="empty-mark">A</div>
          <h1>Место для ясных идей</h1>
          <p>
            Создайте первый блок, запишите мысль
            <br />
            или перетащите сюда изображение.
          </p>
          <div className="empty-shortcuts">
            <span>
              <kbd>R</kbd> Фигура
            </span>
            <span>
              <kbd>T</kbd> Текст
            </span>
            <span>
              <kbd>N</kbd> Стикер
            </span>
          </div>
        </div>
      )}
      {editing && "text" in editing && area && textPosition && (
        <textarea
          ref={text}
          aria-label="Текст объекта"
          className="canvas-text"
          maxLength={20000}
          value={editing.text}
          onChange={(e) => editor.updateText(e.target.value)}
          onBlur={() => editor.endText()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              e.preventDefault();
              editor.endText();
            }
          }}
          style={{
            outlineColor: canvasAccent,
            left: textPosition.x,
            top: textPosition.y,
            width: Math.max(area.w * s.camera.zoom, 120),
            height: Math.max(area.h * s.camera.zoom, 48),
            fontFamily:
              editing.style.font === "mono" ? "Axon Mono" : "Axon Sans",
            fontSize: editing.style.fontSize * s.camera.zoom,
            lineHeight: 1.45,
            textAlign: editing.style.align,
            color: editing.style.color,
            background:
              editing.type === "sticky"
                ? editing.style.fill
                : editing.type === "connector"
                  ? s.doc.background
                  : editing.style.fill === "none"
                    ? s.doc.background
                    : editing.style.fill,
          }}
        />
      )}
    </div>
  );
}
