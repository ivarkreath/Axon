import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Columns3,
  Rows3,
  LockKeyhole,
  UnlockKeyhole,
  Group,
  Ungroup,
  SlidersHorizontal,
  PanelRightClose,
} from "lucide-react";
import { editor, useEditor } from "../editor/store";
import { ColorField, Field, IconButton } from "./components";
import { stickyColors, type AxonObject } from "../model/document";
import type { Align } from "../model/operations";
const labels: Record<AxonObject["type"], string> = {
  shape: "Фигура",
  sticky: "Стикер",
  text: "Текст",
  image: "Изображение",
  stroke: "Штрих",
  connector: "Соединение",
};
export function Inspector({ onHide }: { onHide: () => void }) {
  const s = useEditor();
  const objects = s.doc.objects.filter((o) => s.selection.includes(o.id));
  const o = objects.length === 1 ? objects[0] : null;
  const toolObject =
    !objects.length && !["select", "hand"].includes(s.tool)
      ? editor.newObject(s.tool as AxonObject["type"], { x: 0, y: 0 })
      : null;
  const target = o ?? toolObject;
  const style = target?.style;
  const grouped = objects.some((o) => !!o.groupId),
    locked = objects.some((o) => o.locked);
  const readOnly = grouped || locked;
  const title =
    objects.length > 1
      ? `${objects.length} объектов`
      : o
        ? labels[o.type]
        : toolObject
          ? "Стиль инструмента"
          : "Документ";
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span>
          <SlidersHorizontal size={16} />
          {title}
        </span>
        <IconButton title="Скрыть свойства" onClick={onHide}>
          <PanelRightClose size={17} />
        </IconButton>
      </div>
      <div className="inspector-scroll">
        {!objects.length && !toolObject && (
          <>
            <div className="inspector-section">
              <h3>Рабочее пространство</h3>
              <p className="muted">
                Схемы, заметки и связи.
                <br />
                Всё хранится на вашем компьютере.
              </p>
              <ColorField
                label="Фон документа"
                value={s.doc.background}
                onChange={(background) =>
                  editor.change((doc) => ({ ...doc, background }))
                }
              />
              <div className="segmented">
                <button
                  onClick={() =>
                    editor.change((doc) => ({ ...doc, background: "#181C22" }))
                  }
                  className={s.doc.background === "#181C22" ? "selected" : ""}
                >
                  Графит
                </button>
                <button
                  onClick={() =>
                    editor.change((doc) => ({ ...doc, background: "#F7F8FA" }))
                  }
                  className={s.doc.background === "#F7F8FA" ? "selected" : ""}
                >
                  Светлый
                </button>
              </div>
            </div>
            <div className="inspector-section">
              <h3>Навигация</h3>
              <div className="hint-row">
                <span>Перемещение</span>
                <kbd>Space + drag</kbd>
              </div>
              <div className="hint-row">
                <span>Масштаб</span>
                <kbd>Ctrl + колесо</kbd>
              </div>
              <div className="hint-row">
                <span>Редактировать текст</span>
                <kbd>Двойной клик</kbd>
              </div>
              <button
                className="subtle-button full"
                onClick={() => editor.fit()}
              >
                Показать всё
              </button>
            </div>
          </>
        )}
        {objects.length > 0 && (
          <div className="inspector-section">
            <div className="selection-meta">
              <span className="tag">
                {grouped
                  ? "Группа"
                  : o?.type === "shape"
                    ? {
                        rect: "Прямоугольник",
                        ellipse: "Эллипс",
                        diamond: "Ромб",
                        database: "База данных",
                        callout: "Выноска",
                      }[o.shape]
                    : title}
              </span>
              <IconButton
                title={locked ? "Разблокировать" : "Заблокировать"}
                onClick={() => editor.lock()}
              >
                {locked ? (
                  <LockKeyhole size={16} />
                ) : (
                  <UnlockKeyhole size={16} />
                )}
              </IconButton>
            </div>
            {grouped && (
              <p className="muted">
                Разгруппируйте для изменения отдельных элементов.
              </p>
            )}
            {locked && <p className="muted">Объект защищён от изменений.</p>}
            {o && o.type !== "connector" && o.type !== "stroke" && (
              <fieldset disabled={readOnly} className="dimensions">
                <Field label="Ширина">
                  <input
                    aria-label="Ширина"
                    type="number"
                    min="24"
                    max="100000"
                    value={Math.round(o.w)}
                    onChange={(e) => {
                      const w = +e.target.value;
                      if (w >= 24 && w <= 100000)
                        editor.patchObject(o.id, {
                          w,
                          ...(o.type === "image" ? { h: (w * o.h) / o.w } : {}),
                        });
                    }}
                  />
                </Field>
                <Field label="Высота">
                  <input
                    aria-label="Высота"
                    type="number"
                    min="24"
                    max="100000"
                    value={Math.round(o.h)}
                    onChange={(e) => {
                      const h = +e.target.value;
                      if (h >= 24 && h <= 100000)
                        editor.patchObject(o.id, {
                          h,
                          ...(o.type === "image" ? { w: (h * o.w) / o.h } : {}),
                        });
                    }}
                  />
                </Field>
              </fieldset>
            )}
          </div>
        )}
        {style && target && target.type !== "image" && (
          <fieldset disabled={readOnly} className="inspector-section">
            <h3>Оформление</h3>
            {target.type === "sticky" ? (
              <>
                <span className="field-label">Цвет стикера</span>
                <div className="swatches">
                  {stickyColors.map((color, i) => (
                    <button
                      key={color}
                      aria-label={
                        [
                          "Жёлтый",
                          "Зелёный",
                          "Голубой",
                          "Красный",
                          "Фиолетовый",
                          "Серый",
                        ][i]
                      }
                      className={style.fill === color ? "chosen" : ""}
                      style={{ background: color }}
                      onClick={() =>
                        editor.style({ fill: color, stroke: color })
                      }
                    />
                  ))}
                </div>
              </>
            ) : (
              !["stroke", "connector", "text"].includes(target.type) && (
                <ColorField
                  label="Заливка"
                  value={style.fill}
                  onChange={(fill) => editor.style({ fill })}
                  allowNone
                />
              )
            )}
            {target.type !== "text" && target.type !== "sticky" && (
              <>
                <ColorField
                  label={target.type === "stroke" ? "Цвет штриха" : "Обводка"}
                  value={style.stroke}
                  onChange={(stroke) => editor.style({ stroke })}
                />
                <div className="dimensions">
                  <Field label="Толщина">
                    <select
                      aria-label="Толщина"
                      value={style.strokeWidth}
                      onChange={(e) =>
                        editor.style({ strokeWidth: +e.target.value })
                      }
                    >
                      {[0, 1, 1.5, 2, 2.5, 3, 4, 6, 8, 12].map((n) => (
                        <option key={n} value={n}>
                          {n} px
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Линия">
                    <select
                      aria-label="Стиль линии"
                      value={style.dash ? "dash" : "solid"}
                      onChange={(e) =>
                        editor.style({ dash: e.target.value === "dash" })
                      }
                    >
                      <option value="solid">Сплошная</option>
                      <option value="dash">Пунктир</option>
                    </select>
                  </Field>
                </div>
              </>
            )}
            {target.type === "shape" && target.shape === "rect" && (
              <Field label="Углы">
                <select
                  value={style.radius}
                  onChange={(e) => editor.style({ radius: +e.target.value })}
                >
                  <option value="0">Прямые</option>
                  <option value="12">Скруглённые</option>
                  <option value="24">Мягкие</option>
                </select>
              </Field>
            )}
            {o?.type === "connector" && (
              <>
                <Field label="Маршрут">
                  <select
                    value={o.route}
                    onChange={(e) =>
                      editor.patchObject(o.id, {
                        route: e.target.value as "straight" | "orthogonal",
                      })
                    }
                  >
                    <option value="orthogonal">Прямоугольный</option>
                    <option value="straight">Прямой</option>
                  </select>
                </Field>
                <Field label="Наконечники">
                  <select
                    value={o.arrows}
                    onChange={(e) =>
                      editor.patchObject(o.id, {
                        arrows: e.target.value as "none" | "end" | "both",
                      })
                    }
                  >
                    <option value="none">Без наконечников</option>
                    <option value="end">В конце</option>
                    <option value="both">С двух сторон</option>
                  </select>
                </Field>
              </>
            )}
          </fieldset>
        )}
        {style && target && "text" in target && (
          <fieldset disabled={readOnly} className="inspector-section">
            <h3>Текст</h3>
            <Field label="Шрифт">
              <select
                value={style.font}
                onChange={(e) =>
                  editor.style({ font: e.target.value as "sans" | "mono" })
                }
              >
                <option value="sans">Noto Sans</option>
                <option value="mono">Noto Sans Mono</option>
              </select>
            </Field>
            <div className="type-options">
              <Field label="Размер">
                <input
                  type="number"
                  min="10"
                  max="120"
                  value={style.fontSize}
                  onChange={(e) => {
                    const n = +e.target.value;
                    if (n >= 10 && n <= 120) editor.style({ fontSize: n });
                  }}
                />
              </Field>
              <div className="align-buttons">
                {(
                  [
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const
                ).map(([align, Icon]) => (
                  <IconButton
                    key={align}
                    title={
                      {
                        left: "Текст слева",
                        center: "Текст по центру",
                        right: "Текст справа",
                      }[align]
                    }
                    active={style.align === align}
                    onClick={() => editor.style({ align })}
                  >
                    <Icon size={16} />
                  </IconButton>
                ))}
              </div>
            </div>
            <ColorField
              label="Цвет текста"
              value={style.color}
              onChange={(color) => editor.style({ color })}
            />
            {o && (
              <button
                className="subtle-button full"
                onClick={() => editor.beginText(o.id)}
              >
                Редактировать текст
              </button>
            )}
          </fieldset>
        )}
        {objects.length > 1 && (
          <div className="inspector-section">
            <h3>Расположение</h3>
            <div className="alignment-grid">
              {(
                [
                  ["left", "По левому краю", AlignStartVertical],
                  ["centerX", "По центру горизонтально", AlignCenterVertical],
                  ["right", "По правому краю", AlignEndVertical],
                  ["top", "По верхнему краю", AlignStartHorizontal],
                  ["centerY", "По центру вертикально", AlignCenterHorizontal],
                  ["bottom", "По нижнему краю", AlignEndHorizontal],
                  ["distributeX", "Распределить горизонтально", Columns3],
                  ["distributeY", "Распределить вертикально", Rows3],
                ] as const
              ).map(([mode, label, Icon]) => (
                <IconButton
                  key={mode}
                  title={label}
                  disabled={
                    locked ||
                    (mode.startsWith("distribute") && objects.length < 3)
                  }
                  onClick={() => editor.align(mode as Align)}
                >
                  <Icon size={18} />
                </IconButton>
              ))}
            </div>
            <button
              className="subtle-button full"
              disabled={locked}
              onClick={() => editor.group(grouped)}
            >
              {grouped ? <Ungroup size={16} /> : <Group size={16} />}{" "}
              {grouped ? "Разгруппировать" : "Сгруппировать"}
            </button>
          </div>
        )}
      </div>
      <div className="inspector-foot">
        AXON <span>Локальное пространство</span>
      </div>
    </aside>
  );
}
