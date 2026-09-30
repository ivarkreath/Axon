import {
  MousePointer2,
  Square,
  Circle,
  Diamond,
  Triangle,
  Network,
  Database,
  MessageSquare,
  Spline,
  Type,
  StickyNote,
  Pencil,
  ImagePlus,
  Hand,
  ChevronDown,
  Ellipsis,
} from "lucide-react";
import { editor, useEditor, type Tool } from "../editor/store";
import { IconButton, Menu, MenuItem } from "./components";
import type { ShapeKind } from "../model/document";
const shapes = [
  ["rect", "Прямоугольник", Square],
  ["ellipse", "Эллипс", Circle],
  ["diamond", "Ромб", Diamond],
  ["triangle", "Треугольник", Triangle],
  ["database", "База данных", Database],
  ["callout", "Выноска", MessageSquare],
] as const;
export function Toolbar({ importImage }: { importImage: () => void }) {
  const s = useEditor();
  const compact = s.viewport.w < 900;
  const tools = [
    ["select", "Выбор · V", MousePointer2],
    ["connector", "Соединение · L", Spline],
    ["text", "Текст · T", Type],
    ["sticky", "Стикер · N", StickyNote],
    ["stroke", "Карандаш · P", Pencil],
    ["hand", "Перемещение холста · H", Hand],
  ] as const;
  function shape(kind: ShapeKind) {
    editor.set({ shape: kind });
    editor.setTool("shape");
  }
  return (
    <div className="toolbar panel" role="toolbar" aria-label="Инструменты">
      <IconButton
        title={tools[0][1]}
        active={s.tool === "select"}
        onClick={() => editor.setTool("select")}
      >
        <MousePointer2 size={20} />
      </IconButton>
      <div className="tool-divider" />
      {!compact && (
        <IconButton
          title="Создать mind map"
          active={s.tool === "mindmap"}
          onClick={() => editor.setTool("mindmap")}
        >
          <Network size={20} />
        </IconButton>
      )}
      <div className="shape-tool">
        <IconButton
          title="Фигура · R"
          active={s.tool === "shape"}
          onClick={() => editor.setTool("shape")}
        >
          <Square size={20} />
        </IconButton>
        <Menu label="Виды фигур" trigger={<ChevronDown size={12} />}>
          {shapes.map(([kind, label, Icon]) => (
            <MenuItem key={kind} onSelect={() => shape(kind)}>
              <Icon size={17} />
              {label}
            </MenuItem>
          ))}
        </Menu>
      </div>
      {tools
        .slice(1, 5)
        .filter(([tool]) => !compact || tool !== "sticky")
        .map(([tool, title, Icon]) => (
          <IconButton
            key={tool}
            title={title}
            active={s.tool === tool}
            onClick={() => editor.setTool(tool as Tool)}
          >
            <Icon size={20} />
          </IconButton>
        ))}
      {!compact && (
        <IconButton
          title="Вставить изображение · Ctrl/Cmd + Shift + I"
          onClick={importImage}
        >
          <ImagePlus size={20} />
        </IconButton>
      )}
      <div className="tool-divider" />
      <IconButton
        title="Перемещение холста · H"
        active={s.tool === "hand"}
        onClick={() => editor.setTool("hand")}
      >
        <Hand size={20} />
      </IconButton>
      {compact && (
        <Menu label="Другие инструменты" trigger={<Ellipsis size={20} />}>
          <MenuItem onSelect={() => editor.setTool("mindmap")}>
            <Network size={18} />
            Mind map
          </MenuItem>
          <MenuItem onSelect={() => editor.setTool("sticky")}>
            <StickyNote size={18} />
            Стикер · N
          </MenuItem>
          <MenuItem onSelect={importImage}>
            <ImagePlus size={18} />
            Изображение
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
