import { editor, useEditor } from "../editor/store";
import { Field, Modal } from "./components";
export function Settings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { prefs } = useEditor();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Настройки Axon"
      description="Ваше рабочее пространство, ваши привычки."
    >
      <div className="modal-body">
        <Field label="Тема интерфейса">
          <select
            value={prefs.theme}
            onChange={(e) =>
              editor.preferences({
                ...prefs,
                theme: e.target.value as typeof prefs.theme,
              })
            }
          >
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
            <option value="system">Системная</option>
          </select>
        </Field>
        <Field label="Сетка холста">
          <select
            value={prefs.grid}
            onChange={(e) =>
              editor.preferences({
                ...prefs,
                grid: e.target.value as typeof prefs.grid,
              })
            }
          >
            <option value="none">Нет</option>
            <option value="dots">Точки</option>
            <option value="lines">Линии</option>
          </select>
        </Field>
        {(
          [
            [
              "snapObjects",
              "Привязка к объектам",
              "Направляющие по краям и центрам",
            ],
            ["snapGrid", "Привязка к сетке", "Шаг 20 единиц холста"],
            [
              "reducedMotion",
              "Уменьшить анимации",
              "Мгновенное переключение состояний",
            ],
            [
              "restoreSession",
              "Восстанавливать последнюю сессию",
              "Рабочая копия сохраняется отдельно от файла",
            ],
          ] as const
        ).map(([key, title, description]) => (
          <label className="setting-toggle" key={key}>
            <span>
              <b>{title}</b>
              <small>{description}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={prefs[key]}
              onChange={(e) =>
                editor.preferences({ ...prefs, [key]: e.target.checked })
              }
            />
          </label>
        ))}
        <p className="muted">
          Тема меняет панели приложения. Фон документа настраивается отдельно в
          свойствах холста.
        </p>
      </div>
    </Modal>
  );
}
export function Help({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Горячие клавиши"
      description="На macOS используйте ⌘ вместо Ctrl."
      open={open}
      onClose={onClose}
    >
      <div className="modal-body shortcuts">
        {[
          ["Отменить / повторить", "Ctrl + Z / Ctrl + Shift + Z"],
          ["Копировать / вставить", "Ctrl + C / Ctrl + V"],
          ["Выделить всё", "Ctrl + A"],
          ["Сохранить / сохранить как", "Ctrl + S / Ctrl + Shift + S"],
          ["Дублировать", "Ctrl + D"],
          ["Группа / разгруппировать", "Ctrl + G / Ctrl + Shift + G"],
          ["Удалить", "Delete / Backspace"],
          ["Переместить / большой шаг", "Стрелки / Shift + стрелки"],
          ["Выбор / фигура / соединение", "V / R / L"],
          ["Текст / стикер / карандаш", "T / N / P"],
          ["Перемещение холста", "Space + drag / средняя кнопка"],
          ["Масштаб", "Ctrl + колесо / pinch"],
          ["Показать всё / выделение", "Shift + 1 / Shift + 2"],
          ["Отключить привязки на время", "Alt"],
          ["Квадрат / круг", "Shift при рисовании"],
        ].map(([label, key]) => (
          <div className="hint-row" key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
