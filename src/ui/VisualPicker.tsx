import type { ReactNode } from "react";
import { PropertyPopover } from "./PropertyPopover";
export type VisualOption<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
};
export function VisualPicker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "";
  options: VisualOption<T>[];
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <PropertyPopover
      label={label + (value === "" ? " · Разные" : "")}
      trigger={selected?.icon ?? <span className="mixed-symbol">—</span>}
    >
      <div
        className="visual-options"
        role="group"
        aria-label={label}
        onKeyDown={(e) => {
          const buttons = [...e.currentTarget.querySelectorAll("button")];
          const i = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const direction = ["ArrowRight", "ArrowDown"].includes(e.key)
            ? 1
            : ["ArrowLeft", "ArrowUp"].includes(e.key)
              ? -1
              : 0;
          if (direction || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            buttons[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (i + direction + buttons.length) % buttons.length
            ]?.focus();
          }
        }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            aria-label={option.label}
            data-tooltip={option.label}
            aria-pressed={option.value === value}
            data-close-popover
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
          </button>
        ))}
      </div>
    </PropertyPopover>
  );
}
