import { useState } from "react";
import { Download, Copy } from "lucide-react";
import { Modal, Field } from "./components";
import { editor, useEditor } from "../editor/store";
import { exportBytes, type ExportOptions } from "../io/export";
export function ExportDialog({
  open,
  onClose,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const s = useEditor();
  const [options, setOptions] = useState<ExportOptions>({
    format: "png",
    scope: "all",
    scale: 2,
    transparent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(copy = false) {
    setBusy(true);
    setError("");
    try {
      editor.endText();
      const opts = copy ? { ...options, format: "png" as const } : options;
      const bytes = await exportBytes(
        editor.state.doc,
        editor.state.selection,
        opts,
      );
      if (copy) {
        await window.axon.writePNG(bytes);
        notify("PNG скопирован в буфер обмена");
        onClose();
      } else if (
        await window.axon.exportFile(opts.format, bytes, editor.state.doc.title)
      ) {
        notify("Экспорт сохранён");
        onClose();
      }
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Экспорт схемы"
      description="Чистое содержимое холста, готовое к передаче."
      open={open}
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="export-formats">
          {(["png", "svg", "pdf"] as const).map((format) => (
            <button
              key={format}
              className={options.format === format ? "selected" : ""}
              onClick={() => {
                setOptions({ ...options, format });
                setError("");
              }}
            >
              <b>{format.toUpperCase()}</b>
              <span>
                {{ png: "Изображение", svg: "Вектор", pdf: "Документ" }[format]}
              </span>
            </button>
          ))}
        </div>
        <Field label="Область">
          <select
            value={options.scope}
            onChange={(e) =>
              setOptions({
                ...options,
                scope: e.target.value as "all" | "selection",
              })
            }
          >
            <option value="all">
              Весь документ · {s.doc.objects.length} объектов
            </option>
            <option value="selection" disabled={!s.selection.length}>
              Выделение · {s.selection.length} объектов
            </option>
          </select>
        </Field>
        {options.format === "png" && (
          <Field label="Масштаб">
            <select
              value={options.scale}
              onChange={(e) =>
                setOptions({ ...options, scale: +e.target.value as 1 | 2 })
              }
            >
              <option value="1">1× — исходный размер</option>
              <option value="2">2× — повышенная чёткость</option>
            </select>
          </Field>
        )}
        {options.format !== "pdf" && (
          <label className="setting-toggle">
            <span>Прозрачный фон</span>
            <input
              type="checkbox"
              checked={options.transparent}
              onChange={(e) =>
                setOptions({ ...options, transparent: e.target.checked })
              }
            />
          </label>
        )}
        <p className="muted">
          {options.format === "pdf"
            ? "Одна страница по размеру схемы. Текст сохраняется векторными контурами."
            : options.format === "svg"
              ? "Фигуры и текст остаются векторными. Изображения встроены в файл."
              : "Поля 32 px. Сетка, панели и выделение в экспорт не попадут."}
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="subtle-button"
            disabled={busy}
            onClick={() => void run(true)}
          >
            <Copy size={16} />
            Как PNG
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void run()}
          >
            <Download size={17} />
            {busy ? "Подготовка…" : "Сохранить экспорт"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
