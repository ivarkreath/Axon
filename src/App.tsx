import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Save,
  Undo2,
  Redo2,
  Settings2,
  CircleHelp,
  Minus,
  Plus,
  Maximize,
  Scan,
  PanelRightOpen,
  Check,
  Circle,
  FilePlus2,
  FolderOpen,
  Clock3,
  X,
} from "lucide-react";
import { editor, useEditor } from "./editor/store";
import { Canvas } from "./editor/Canvas";
import { Toolbar } from "./ui/Toolbar";
import { Inspector } from "./ui/Inspector";
import { IconButton, Logo, Menu, MenuItem, Separator } from "./ui/components";
import { Settings, Help } from "./ui/Settings";
import { ExportDialog } from "./ui/ExportDialog";
import { ContextMenu } from "./ui/ContextMenu";
import { exportBytes } from "./io/export";
import { serializeDocument } from "./model/document";
import type { BackupStatus, FileCommand, Session } from "./shared/contracts";
export default function App({ initial }: { initial: Session }) {
  const s = useEditor();
  const [fileState, setFileState] = useState(initial);
  const [savedContent, setSavedContent] = useState(
    initial.dirty ? "" : serializeDocument(initial.document),
  );
  const [backup, setBackup] = useState<BackupStatus>({
    state: initial.preferences.restoreSession ? "pending" : "off",
  });
  const [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [exports, setExports] = useState(false),
    [inspector, setInspector] = useState(true);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(
    initial.recovered
      ? {
          message: "Восстановлена последняя рабочая копия. Сохраните документ.",
          error: false,
        }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dirty = serializeDocument(s.doc) !== savedContent;
  const notify = useCallback(
    (message: string) => setToast({ message, error: false }),
    [],
  );
  const error = useCallback(
    (message: string) =>
      setToast({ message: message.replace(/^Error: /, ""), error: true }),
    [],
  );
  const file = useCallback(
    async (command: FileCommand, index?: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      editor.endText();
      try {
        const result = await window.axon.file(command, editor.state.doc, index);
        if (result) {
          setFileState(result);
          setSavedContent(serializeDocument(result.document));
          if (command === "new" || command === "open" || command === "recent")
            editor.load(result);
          else notify("Файл сохранён");
        }
      } catch (e) {
        error(String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [notify, error],
  );
  const importImage = useCallback(async () => {
    try {
      const asset = await window.axon.importImage();
      if (asset) editor.addImage(asset);
    } catch (e) {
      error(String(e));
    }
  }, [error]);
  const copyPNG = useCallback(async () => {
    try {
      const bytes = await exportBytes(
        editor.state.doc,
        editor.state.selection,
        {
          format: "png",
          scope: editor.state.selection.length ? "selection" : "all",
          scale: 2,
          transparent: false,
        },
      );
      await window.axon.writePNG(bytes);
      notify("PNG скопирован");
    } catch (e) {
      error(String(e));
    }
  }, [notify, error]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.axon.updateDocument(s.doc).catch((e) => error(String(e)));
    }, 120);
    return () => clearTimeout(timer);
  }, [s.doc, error]);
  useEffect(() => window.axon.onBackup(setBackup), []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      s.prefs.theme === "system"
        ? systemDark
          ? "dark"
          : "light"
        : s.prefs.theme;
    document.documentElement.dataset.motion = s.prefs.reducedMotion
      ? "reduced"
      : "full";
    document.title = `${dirty ? "• " : ""}${s.doc.title} — Axon`;
  }, [s.prefs.theme, s.prefs.reducedMotion, systemDark, dirty, s.doc.title]);
  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handler = (e: Event) => error((e as CustomEvent).detail);
    window.addEventListener("axon-error", handler);
    return () => window.removeEventListener("axon-error", handler);
  }, [error]);
  useEffect(
    () =>
      window.axon.onCommand((command) => {
        if (["new", "open", "save", "saveAs"].includes(command))
          void file(command as FileCommand);
        if (command === "close") {
          editor.endText();
          void window.axon
            .close(editor.state.doc)
            .catch((e) => error(String(e)));
        }
      }),
    [file, error],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const textInput = !!target.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      const modal = !!document.querySelector('[role="dialog"]');
      const mod = e.ctrlKey || e.metaKey;
      const key =
        mod && e.code.startsWith("Key")
          ? e.code.slice(3).toLowerCase()
          : e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        void file(e.shiftKey ? "saveAs" : "save");
        return;
      }
      if (textInput || modal) return;
      if (mod) {
        const commands: Record<string, () => void> = {
          z: () => (e.shiftKey ? editor.redo() : editor.undo()),
          y: () => editor.redo(),
          a: () => editor.select(editor.state.doc.objects.map((o) => o.id)),
          d: () => editor.duplicate(),
          g: () => editor.group(e.shiftKey),
          c: () => void editor.copy().catch((e) => error(String(e))),
          v: () => void editor.paste().catch((e) => error(String(e))),
          n: () => void file("new"),
          o: () => void file("open"),
          i: () => {
            if (e.shiftKey) void importImage();
          },
        };
        if (commands[key]) {
          e.preventDefault();
          commands[key]();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editor.remove();
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        editor.move({
          x: e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
          y: e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
        });
        return;
      }
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        editor.fit();
        return;
      }
      if (e.shiftKey && e.code === "Digit2") {
        e.preventDefault();
        editor.fit(true);
        return;
      }
      const tools = {
        KeyV: "select",
        KeyR: "shape",
        KeyL: "connector",
        KeyT: "text",
        KeyN: "sticky",
        KeyP: "stroke",
        KeyH: "hand",
      } as const;
      if (e.code in tools) {
        e.preventDefault();
        editor.setTool(tools[e.code as keyof typeof tools]);
      }
      if (e.key === "?") setHelp(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [file, error, importImage]);
  const backupText =
    backup.state === "saved"
      ? "Рабочая копия записана"
      : backup.state === "pending"
        ? "Запись рабочей копии…"
        : backup.state === "error"
          ? "Ошибка рабочей копии"
          : "Автовосстановление выключено";
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>Axon</span>
        </div>
        <div className="header-separator" />
        <Menu
          label="Файл"
          trigger={
            <>
              Файл <ChevronDown size={14} />
            </>
          }
        >
          <MenuItem onSelect={() => void file("new")} shortcut="Ctrl N">
            <FilePlus2 size={16} />
            Новый документ
          </MenuItem>
          <MenuItem onSelect={() => void file("open")} shortcut="Ctrl O">
            <FolderOpen size={16} />
            Открыть…
          </MenuItem>
          <Separator />
          <MenuItem onSelect={() => void file("save")} shortcut="Ctrl S">
            <Save size={16} />
            Сохранить
          </MenuItem>
          <MenuItem
            onSelect={() => void file("saveAs")}
            shortcut="Ctrl Shift S"
          >
            Сохранить как…
          </MenuItem>
          {fileState.recents.length > 0 && (
            <>
              <Separator />
              <div className="menu-label">
                <Clock3 size={14} />
                Последние файлы
              </div>
              {fileState.recents.map((name, i) => (
                <MenuItem key={name} onSelect={() => void file("recent", i)}>
                  <span className="recent-name" title={name}>
                    {name.split(/[\\/]/).at(-1)}
                  </span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <div className="document-title">
          <input
            aria-label="Название документа"
            value={s.doc.title}
            maxLength={200}
            onChange={(e) => {
              const title = e.target.value || "Без названия";
              editor.change((doc) => ({ ...doc, title }));
            }}
          />
          <span className={`save-status ${dirty ? "unsaved" : ""}`}>
            {dirty ? (
              <Circle size={7} fill="currentColor" />
            ) : (
              <Check size={12} />
            )}
            <span>
              {dirty
                ? "Есть изменения"
                : fileState.path
                  ? "Файл сохранён"
                  : "Новый документ"}
            </span>
          </span>
        </div>
        <div className="header-actions">
          <div className="history-buttons">
            <IconButton
              title="Отменить · Ctrl/Cmd + Z"
              disabled={!editor.history.canUndo}
              onClick={() => editor.undo()}
            >
              <Undo2 size={18} />
            </IconButton>
            <IconButton
              title="Повторить · Ctrl/Cmd + Shift + Z"
              disabled={!editor.history.canRedo}
              onClick={() => editor.redo()}
            >
              <Redo2 size={18} />
            </IconButton>
          </div>
          <div className="header-separator" />
          <IconButton
            title="Сохранить · Ctrl/Cmd + S"
            disabled={busy}
            onClick={() => void file("save")}
          >
            <Save size={18} />
          </IconButton>
          <button
            className="primary-button export-button"
            onClick={() => {
              editor.endText();
              setExports(true);
            }}
          >
            <Download size={16} />
            Экспорт
          </button>
          <IconButton
            title="Настройки"
            active={settings}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </IconButton>
        </div>
      </header>
      <main className={`workspace ${inspector ? "has-inspector" : ""}`}>
        <section className="canvas-section">
          <Canvas onContext={(x, y) => setContext({ x, y })} error={error} />
          <Toolbar importImage={() => void importImage()} />
          <div className="bottom-left">
            <span className="object-count">
              {s.selection.length
                ? `Выбрано ${s.selection.length}`
                : `Объектов: ${s.doc.objects.length}`}
            </span>
            <span className="bottom-divider" />
            <span
              className={
                backup.state === "error" ? "backup-error" : "backup-status"
              }
              title={
                backup.time
                  ? new Date(backup.time).toLocaleTimeString("ru")
                  : undefined
              }
            >
              {backupText}
            </span>
          </div>
          <div className="navigation panel">
            <IconButton
              title="Уменьшить"
              onClick={() => editor.zoom(s.camera.zoom / 1.2)}
            >
              <Minus size={16} />
            </IconButton>
            <button
              className="zoom-value"
              title="Масштаб 100%"
              onClick={() => editor.zoom(1)}
            >
              {Math.round(s.camera.zoom * 100)}%
            </button>
            <IconButton
              title="Увеличить"
              onClick={() => editor.zoom(s.camera.zoom * 1.2)}
            >
              <Plus size={16} />
            </IconButton>
            <div className="tool-divider" />
            <IconButton
              title="Показать всё · Shift + 1"
              onClick={() => editor.fit()}
            >
              <Maximize size={17} />
            </IconButton>
            <IconButton
              title="Приблизить выделение · Shift + 2"
              disabled={!s.selection.length}
              onClick={() => editor.fit(true)}
            >
              <Scan size={18} />
            </IconButton>
          </div>
          <div className="canvas-utilities">
            {!inspector && (
              <IconButton
                title="Показать свойства"
                onClick={() => setInspector(true)}
              >
                <PanelRightOpen size={18} />
              </IconButton>
            )}
            <IconButton title="Горячие клавиши" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
            </IconButton>
          </div>
        </section>
        {inspector && <Inspector onHide={() => setInspector(false)} />}
      </main>
      <Settings open={settings} onClose={() => setSettings(false)} />
      <Help open={help} onClose={() => setHelp(false)} />
      <ExportDialog
        open={exports}
        onClose={() => setExports(false)}
        notify={notify}
      />
      <ContextMenu
        position={context}
        onClose={() => setContext(null)}
        copyPNG={() => void copyPNG()}
        error={error}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
