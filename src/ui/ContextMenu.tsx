import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useRef, useState } from "react";
import {
  Copy,
  CopyPlus,
  Trash2,
  LockKeyhole,
  Group,
  Ungroup,
  Layers,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Image,
  ChevronRight,
  Check,
} from "lucide-react";
import { MenuItem, Separator } from "./components";
import { ColorPicker } from "./ColorPicker";
import { PropertyPopover } from "./PropertyPopover";
import { editor, useEditor } from "../editor/store";
export function ContextMenu({
  position,
  onClose,
  copyPNG,
  error,
}: {
  position: { x: number; y: number } | null;
  onClose: () => void;
  copyPNG: () => void;
  error: (message: string) => void;
}) {
  const s = useEditor();
  const themeMenu = useRef<HTMLDivElement>(null);
  const [colorAnchor, setColorAnchor] = useState<{
    x: number;
    y: number;
    session: string;
  } | null>(null);
  const selected = s.doc.objects.filter((o) => s.selection.includes(o.id));
  const locked = selected.some((o) => o.locked);
  return (
    <>
      <Dropdown.Root
        open={!!position}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Dropdown.Trigger
          style={{
            position: "fixed",
            left: position?.x ?? 0,
            top: position?.y ?? 0,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
          aria-label="Контекстное меню"
        />
        <Dropdown.Portal>
          <Dropdown.Content
            className="menu-content"
            align="start"
            sideOffset={0}
            collisionPadding={12}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {!selected.length && (
              <>
                <Dropdown.Sub>
                  <Dropdown.SubTrigger className="menu-item" aria-label="Тема" onPointerLeave={(event) => {
                    // Fast entry into a flipped portal must not focus the parent menu.
                    if (event.relatedTarget instanceof Node && themeMenu.current?.contains(event.relatedTarget)) event.preventDefault();
                  }}>
                    <span>Тема</span>
                    <ChevronRight size={16} />
                  </Dropdown.SubTrigger>
                  <Dropdown.Portal>
                    <Dropdown.SubContent
                      ref={themeMenu}
                      className="menu-content"
                      sideOffset={4}
                      collisionPadding={12}
                    >
                      {[
                        ["#181C22", "Графитовая"],
                        ["#F7F8FA", "Светлая"],
                      ].map(([background, label]) => (
                        <Dropdown.CheckboxItem
                          key={background}
                          className="menu-item"
                          checked={
                            s.doc.background.toUpperCase() === background
                          }
                          onSelect={() =>
                            editor.change((doc) => ({ ...doc, background }))
                          }
                        >
                          <span>{label}</span>
                          <Dropdown.ItemIndicator>
                            <Check size={16} />
                          </Dropdown.ItemIndicator>
                        </Dropdown.CheckboxItem>
                      ))}
                      <Separator />
                      <Dropdown.Item
                        className="menu-item"
                        onSelect={(e) => {
                          const r = (
                            e.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          setColorAnchor({
                            x: r.left,
                            y: r.top,
                            session: s.sessionId,
                          });
                        }}
                      >
                        Другой цвет…
                        {!["#181C22", "#F7F8FA"].includes(
                          s.doc.background.toUpperCase(),
                        ) && <Check size={16} />}
                      </Dropdown.Item>
                    </Dropdown.SubContent>
                  </Dropdown.Portal>
                </Dropdown.Sub>
                <Separator />
                <MenuItem onSelect={() => editor.fit()}>Показать всё</MenuItem>
                <Separator />
                <MenuItem
                  onSelect={() =>
                    void editor.paste().catch((e) => error(String(e)))
                  }
                  shortcut="Ctrl V"
                >
                  Вставить
                </MenuItem>
              </>
            )}
            {selected.length > 0 && (
              <>
                {selected.length === 1 &&
                  selected[0].type === "shape" &&
                  selected[0].mind && (
                    <>
                      <MenuItem onSelect={() => editor.topic()} shortcut="Tab">
                        Добавить подтему
                      </MenuItem>
                      <MenuItem
                        onSelect={() => editor.topic(true)}
                        shortcut="Enter"
                      >
                        Добавить тему рядом
                      </MenuItem>
                      <Separator />
                    </>
                  )}
                <MenuItem
                  onSelect={() =>
                    void editor.copy().catch((e) => error(String(e)))
                  }
                  disabled={!selected.length}
                  shortcut="Ctrl C"
                >
                  <Copy size={16} />
                  Копировать
                </MenuItem>
                <MenuItem
                  onSelect={() =>
                    void editor.paste().catch((e) => error(String(e)))
                  }
                  shortcut="Ctrl V"
                >
                  Вставить
                </MenuItem>
                <MenuItem
                  onSelect={() => editor.duplicate()}
                  disabled={!selected.length}
                  shortcut="Ctrl D"
                >
                  <CopyPlus size={16} />
                  Дублировать
                </MenuItem>
                <MenuItem onSelect={copyPNG} disabled={!selected.length}>
                  <Image size={16} />
                  Скопировать как PNG
                </MenuItem>
                <Separator />
                <MenuItem
                  onSelect={() => editor.group()}
                  disabled={selected.length < 2 || locked}
                  shortcut="Ctrl G"
                >
                  <Group size={16} />
                  Сгруппировать
                </MenuItem>
                <MenuItem
                  onSelect={() => editor.group(true)}
                  disabled={!selected.some((o) => o.groupId) || locked}
                >
                  <Ungroup size={16} />
                  Разгруппировать
                </MenuItem>
                <MenuItem
                  onSelect={() => editor.lock()}
                  disabled={!selected.length}
                >
                  <LockKeyhole size={16} />
                  {locked ? "Разблокировать" : "Заблокировать"}
                </MenuItem>
                <Separator />
                <Dropdown.Label className="menu-label">
                  <Layers size={14} />
                  Порядок объектов
                </Dropdown.Label>
                {(
                  [
                    ["forward", "На уровень вперёд", ArrowUp],
                    ["backward", "На уровень назад", ArrowDown],
                    ["front", "На передний план", ChevronsUp],
                    ["back", "На задний план", ChevronsDown],
                  ] as const
                ).map(([mode, label, Icon]) => (
                  <MenuItem
                    key={mode}
                    onSelect={() => editor.order(mode)}
                    disabled={!selected.length || locked}
                  >
                    <Icon size={16} />
                    {label}
                  </MenuItem>
                ))}
                <Separator />
                <MenuItem
                  onSelect={() => editor.remove()}
                  disabled={!selected.length || locked}
                  shortcut="Delete"
                >
                  <Trash2 size={16} />
                  Удалить
                </MenuItem>
              </>
            )}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      {colorAnchor && colorAnchor.session === s.sessionId && (
        <PropertyPopover
          label="Фон документа"
          anchor={colorAnchor}
          onClose={() => setColorAnchor(null)}
        >
          <ColorPicker
            label="Фон документа"
            value={s.doc.background}
            onChange={(background) =>
              editor.change((doc) => ({ ...doc, background }))
            }
          />
        </PropertyPopover>
      )}
    </>
  );
}
