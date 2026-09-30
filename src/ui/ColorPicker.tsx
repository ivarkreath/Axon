import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { colorSchema, isLight } from "../model/document";

export const swatches = [
  "#FFFFFF",
  "#202B38",
  "#252D38",
  "#8CACC5",
  "#83CEFF",
  "#F1D58A",
  "#B7DAB7",
  "#AACFEA",
  "#EDB2AE",
  "#CEBCEB",
];
export function ColorPicker({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  const [hex, setHex] = useState(value === "none" ? "" : value);
  const [selected, setSelected] = useState(value);
  const colorInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setHex(value === "none" ? "" : value);
    setSelected(value);
  }, [value]);
  useEffect(() => {
    if (colorInput.current)
      colorInput.current.value = colorSchema.safeParse(selected).success
        ? selected
        : "#FFFFFF";
  }, [selected]);
  useEffect(() => {
    const input = colorInput.current!;
    // Native change commits the chooser once; input events are its temporary preview.
    const commit = () => {
      const color = input.value.toUpperCase();
      setSelected(color);
      setHex(color);
      onChange(color);
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [onChange]);
  const apply = (color: string) => {
    setSelected(color);
    setHex(color === "none" ? "" : color);
    onChange(color);
  };
  const valid = colorSchema.safeParse(hex).success;
  return (
    <div className="color-picker" aria-label={label}>
      <form
        className="hex-field"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) apply(hex.toUpperCase());
        }}
      >
        <input
          ref={colorInput}
          className="custom-color"
          type="color"
          aria-label={`${label}: выбрать произвольный цвет`}
          data-tooltip="Выбрать произвольный цвет"
        />
        <label>
          <input
            aria-label={`${label} HEX`}
            value={hex}
            placeholder="#RRGGBB"
            maxLength={7}
            spellCheck={false}
            aria-invalid={!!hex && !valid}
            onChange={(e) => setHex(e.target.value)}
          />
        </label>
        <button
          type="submit"
          aria-label="Применить цвет"
          data-tooltip="Применить цвет"
          disabled={!valid || hex.toUpperCase() === selected.toUpperCase()}
        >
          <Check size={18} />
        </button>
      </form>
      <div
        className="swatches"
        role="group"
        aria-label={`${label}: готовые цвета`}
      >
        {swatches.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            data-tooltip={color}
            aria-pressed={selected.toUpperCase() === color}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => apply(color)}
          >
            <span
              className="swatch-disc"
              style={{
                background: color,
                color: isLight(color) ? "#202B38" : "#FFFFFF",
              }}
            >
              {selected.toUpperCase() === color && (
                <Check size={14} strokeWidth={3} />
              )}
            </span>
          </button>
        ))}
        {allowNone && (
          <button
            type="button"
            aria-label="Без заливки"
            data-tooltip="Без заливки"
            aria-pressed={selected === "none"}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => apply("none")}
          >
            <span className="swatch-disc transparent-disc">
              {selected === "none" ? <Check size={14} /> : "∅"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
