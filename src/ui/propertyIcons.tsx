import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { Connector, Marker, Style } from "../model/document";
import { markerGeometry } from "../model/markers";
import type { VisualOption } from "./VisualPicker";
export const lineOptions = (
  outline: boolean,
): VisualOption<"solid" | "dash">[] => [
  {
    value: "solid",
    label: outline ? "Сплошная обводка" : "Сплошная линия",
    icon: (
      <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden="true">
        <path d="M2 10H22" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    value: "dash",
    label: outline ? "Пунктирная обводка" : "Пунктирная линия",
    icon: (
      <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden="true">
        <path
          d="M2 10H22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="5 3"
        />
      </svg>
    ),
  },
];
export const routeOptions: VisualOption<Connector["route"]>[] = [
  {
    value: "straight",
    label: "Прямая линия",
    icon: (
      <svg width="24" height="20" aria-hidden="true">
        <path
          d="M3 16L21 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
  {
    value: "orthogonal",
    label: "Угловая линия",
    icon: (
      <svg width="24" height="20" aria-hidden="true">
        <path
          d="M3 16H12V4H21"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
  {
    value: "curved",
    label: "Плавная линия",
    icon: (
      <svg width="24" height="20" aria-hidden="true">
        <path
          d="M3 16C17 16 7 4 21 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
];
export const cornerOptions: VisualOption<string>[] = [
  ["0", "Прямые углы", 0],
  ["12", "Скруглённые углы", 3],
  ["24", "Мягкие углы", 7],
].map(([value, label, radius]) => ({
  value: String(value),
  label: String(label),
  icon: (
    <svg width="24" height="20" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="14"
        rx={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  ),
}));
export const alignOptions: VisualOption<Style["align"]>[] = [
  { value: "left", label: "По левому краю", icon: <AlignLeft size={20} /> },
  { value: "center", label: "По центру", icon: <AlignCenter size={20} /> },
  { value: "right", label: "По правому краю", icon: <AlignRight size={20} /> },
];
export function markerOptions(side: "start" | "end"): VisualOption<Marker>[] {
  return (
    [
      ["none", "Без наконечника"],
      ["arrow", "Обычная стрелка"],
      ["open", "Открытая стрелка"],
      ["triangle", "Контурный треугольник"],
      ["circle", "Контурный круг"],
      ["diamond", "Контурный ромб"],
    ] as const
  ).map(([value, label]) => {
    const head = markerGeometry(
      value,
      { x: 22, y: 10 },
      { x: 2, y: 10 },
      10,
      1.5,
    );
    return {
      value,
      label,
      icon: (
        <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden="true">
          <g
            transform={
              side === "start" ? "translate(24 0) scale(-1 1)" : undefined
            }
          >
            <path
              d={`M2 10H${22 - (head?.inset ?? 0)}`}
              stroke="currentColor"
              strokeWidth="1.5"
            />
            {head && (
              <path
                d={head.d}
                fill={head.filled ? "currentColor" : "none"}
                stroke={head.filled ? "none" : "currentColor"}
                strokeWidth={head.width}
                strokeLinejoin="round"
              />
            )}
          </g>
        </svg>
      ),
    };
  });
}
