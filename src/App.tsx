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
  FilePlus2,
  FolderOpen,
  Clock3,
  X,
} from "lucide-react";
import { editor, useEditor } from "./editor/store";
import { Canvas } from "./editor/Canvas";
import { Toolbar } from "./ui/Toolbar";
import { Inspector } from "./ui/Inspector";
import { TooltipLayer } from "./ui/TooltipLayer";
import { IconButton, Logo, Menu, MenuItem, Separator } from "./ui/components";
import { Settings, Help } from "./ui/Settings";
import { ExportDialog } from "./ui/ExportDialog";
import { ContextMenu } from "./ui/ContextMenu";
import { exportBytes } from "./io/export";
import { documentName } from "./shared/documentName";
import type { AxonDocument } from "./model/document";

import type { BackupStatus, FileCommand, Session } from "./shared/contracts";
export default function App({ initial }: { initial: Session }) {
  const s = useEditor();
  const [fileState, setFileState] = useState(initial);
  const [backup, setBackup] = useState<BackupStatus>({
    state: initial.preferences.restoreSession ? "pending" : "off",
  });
  const [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [exports, setExports] = useState(false);
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
  const syncedDocuments = useRef(new WeakMap<object, AxonDocument>());
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dirty = editor.isDirty();
  const activeTab = editor.tabs.get(s.sessionId);
  const activeName = documentName(activeTab?.session);
  const [folder, setFolder] = useState<{
    path: string | null;
    files: string[];
  } | null>(null);
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
      editor.finishOperation();
      const origin = editor.state.sessionId;
      const snapshot = editor.state.doc;
      const originTab = editor.tabs.get(origin);
      const previousSync = originTab && syncedDocuments.current.get(originTab);
      if (originTab) syncedDocuments.current.set(originTab, snapshot);
      try {
        const result = await window.axon.file(
          command,
          snapshot,
          index,
          origin,
        );
        if (result) {
          setFileState(result);
          editor.acceptSession(result);
          if (["new", "open", "recent", "folder"].includes(command))
            editor.activate(result.sessionId!);
          else notify("Файл сохранён");
        }
      } catch (e) {
        if (originTab && syncedDocuments.current.get(originTab) === snapshot) {
          if (previousSync) syncedDocuments.current.set(originTab, previousSync);
          else syncedDocuments.current.delete(originTab);
        }
        error(String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [notify, error],
  );
  const activate = useCallback(
    async (id: string) => {
      editor.finishOperation();
      const before = editor.state;
      editor.activate(id);
      setContext(null);
      setExports(false);
      try {
        const tab = editor.tabs.get(before.sessionId);
        const view = { camera: before.camera, selection: before.selection };
        if (tab && (syncedDocuments.current.get(tab) ?? tab.session.document) !== before.doc) {
          await window.axon.updateDocument(before.doc, before.sessionId, view);
          syncedDocuments.current.set(tab, before.doc);
        } else await window.axon.updateView(before.sessionId, view);
        await window.axon.activateSession(id);
      } catch (e) {
        error(String(e));
      }
      document.querySelector<SVGSVGElement>(".canvas")?.focus();
    },
    [error],
  );
  const closeTab = useCallback(
    async (id = editor.state.sessionId) => {
      if (busyRef.current) return;
      editor.finishOperation();
      const tab = editor.tabs.get(id);
      if (!tab) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const result = await window.axon.closeTab(id, tab.state.doc);
        if (result) {
          editor.closeSession(id, result);
          setFileState(result);
          setContext(null);
        }
      } catch (e) {
        error(String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [error],
  );
  const showFolder = async (select = false) => {
    try {
      setFolder(await window.axon.folder(select));
    } catch (e) {
      error(String(e));
    }
  };
  const importImage = useCallback(async () => {
    const sessionId = editor.state.sessionId;
    try {
      const asset = await window.axon.importImage();
      if (asset && editor.state.sessionId === sessionId) editor.addImage(asset);
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
    const tab = editor.tabs.get(s.sessionId);
    if (!tab) return;
    if (!syncedDocuments.current.has(tab)) syncedDocuments.current.set(tab, tab.session.document);
    if (s.interacting || syncedDocuments.current.get(tab) === s.doc) return;
    const timer = setTimeout(() => {
      if (syncedDocuments.current.get(tab) === s.doc) return;
      syncedDocuments.current.set(tab, s.doc);
      void window.axon
        .updateDocument(s.doc, s.sessionId, {
          camera: tab.state.camera, selection: tab.state.selection,
        })
        .catch((e) => {
          if (syncedDocuments.current.get(tab) === s.doc) syncedDocuments.current.delete(tab);
          error(String(e));
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [s.doc, s.sessionId, s.interacting, error]);
  useEffect(() => {
    if (s.interacting) return;
    const timer = setTimeout(() => {
      void window.axon.updateView(s.sessionId, {
        camera: s.camera, selection: s.selection,
      }).catch((e) => error(String(e)));
    }, 120);
    return () => clearTimeout(timer);
  }, [s.sessionId, s.camera, s.selection, s.interacting, error]);
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
    document.title = `${dirty ? "• " : ""}${activeName} — Axon`;
  }, [s.prefs.theme, s.prefs.reducedMotion, systemDark, dirty, activeName]);
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
          editor.finishOperation();
          void window.axon
            .close(editor.state.doc, editor.snapshots())
            .catch((e) => error(String(e)));
        }
      }),
    [file, error],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (document.querySelector(".property-popup") || target.closest('[role="menu"]')) return;
      const textInput = !!target.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      const modal = !!document.querySelector('[role="dialog"]');
      const mod = e.ctrlKey || e.metaKey;
      const key =
        mod && e.code.startsWith("Key")
          ? e.code.slice(3).toLowerCase()
          : e.key.toLowerCase();
      if (mod && key === "s" && !modal) {
        e.preventDefault();
        void file(e.shiftKey ? "saveAs" : "save");
        return;
      }
      if (mod && key === "w" && !modal) {
        e.preventDefault();
        void closeTab();
        return;
      }
      if (textInput || modal) return;
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const ids = [...editor.tabs.keys()];
        const i = ids.indexOf(editor.state.sessionId);
        void activate(
          ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length],
        );
        return;
      }
      const canvasFocus =
        !!target.closest(".canvas-wrap") || target === document.body;
      if (!canvasFocus && !(mod && ["n", "o"].includes(key))) return;
      const mind = editor.state.doc.objects.find(
        (o) =>
          editor.state.selection.includes(o.id) && o.type === "shape" && o.mind,
      );
      if (!mod && mind && (e.key === "Tab" || e.key === "Enter")) {
        e.preventDefault();
        editor.topic(e.key === "Enter");
        return;
      }
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
  }, [file, error, importImage, activate, closeTab]);
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
        <div className="brand" title="Axon" aria-label="Axon">
          <Logo />
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
            className="icon-button"
            title="Экспорт"
            aria-label="Экспорт"
            onClick={() => {
              editor.endText();
              setExports(true);
            }}
          >
            <Download size={16} />
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
      <div className="tabbar">
        <IconButton title="Рабочая папка" onClick={() => void showFolder()}>
          <FolderOpen size={17} />
        </IconButton>
        <div className="document-tabs" role="tablist" aria-label="Документы">
          {[...editor.tabs].map(([id, tab]) => (
            <div
              key={id}
              className={
                id === s.sessionId ? "document-tab active" : "document-tab"
              }
            >
              <button
                role="tab"
                aria-selected={id === s.sessionId}
                title={tab.session.path ?? "Новый документ"}
                onClick={() => void activate(id)}
              >
                {editor.isDirty(id) ? "● " : ""}
                {documentName(tab.session)}
                {tab.session.path &&
                [...editor.tabs.values()].some(
                  (t) =>
                    t !== tab &&
                    t.session.path?.split(/[\\/]/).at(-1) ===
                      tab.session.path?.split(/[\\/]/).at(-1),
                )
                  ? " · " + tab.session.path.split(/[\\/]/).at(-2)
                  : ""}
                {tab.session.unavailable ? " · файл недоступен" : ""}
              </button>
              <button
                aria-label={"Закрыть вкладку " + documentName(tab.session)}
                title="Закрыть вкладку"
                onClick={() => void closeTab(id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <IconButton title="Новая вкладка" onClick={() => void file("new")}>
          <Plus size={16} />
        </IconButton>
      </div>
      {folder && (
        <div className="folder-list panel">
          <div className="property-row">
            <strong title={folder.path ?? ""}>
              {folder.path?.split(/[\\/]/).at(-1) ?? "Рабочая папка"}
            </strong>
            <IconButton
              title="Закрыть список папки"
              onClick={() => setFolder(null)}
            >
              <X size={16} />
            </IconButton>
          </div>
          <button onClick={() => void showFolder(true)}>Выбрать папку…</button>
          {folder.files.map((name, i) => (
            <button
              key={name}
              onClick={() => {
                setFolder(null);
                void file("folder", i);
              }}
            >
              {name}
            </button>
          ))}
          {!folder.files.length && (
            <p className="muted">В папке нет документов Axon</p>
          )}
        </div>
      )}
      <main className="workspace">
        <section className="canvas-section">
          <Canvas onContext={(x, y) => setContext({ x, y })} error={error} />
          <Toolbar importImage={() => void importImage()} />
          <Inspector key={s.sessionId} />
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
            {s.viewport.w < 900 ? (
              <Menu
                label="Масштаб и навигация"
                trigger={
                  <>
                    {Math.round(s.camera.zoom * 100)}% <ChevronDown size={14} />
                  </>
                }
              >
                <MenuItem onSelect={() => editor.zoom(s.camera.zoom / 1.2)}>
                  Уменьшить
                </MenuItem>
                <MenuItem onSelect={() => editor.zoom(1)}>
                  Масштаб 100%
                </MenuItem>
                <MenuItem onSelect={() => editor.zoom(s.camera.zoom * 1.2)}>
                  Увеличить
                </MenuItem>
                <Separator />
                <MenuItem shortcut="Shift + 1" onSelect={() => editor.fit()}>
                  Показать всё
                </MenuItem>
                <MenuItem
                  shortcut="Shift + 2"
                  disabled={!s.selection.length}
                  onSelect={() => editor.fit(true)}
                >
                  Приблизить выделение
                </MenuItem>
              </Menu>
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="canvas-utilities">
            <IconButton title="Горячие клавиши" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
            </IconButton>
          </div>
        </section>
      </main>
      <Settings open={settings} onClose={() => setSettings(false)} />
      <TooltipLayer />
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
