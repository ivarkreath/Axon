import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  parseDocument,
  serializeDocument,
  type Asset,
} from "../src/model/document";
import {
  defaults,
  preferencesSchema,
  type Session,
  type BackupStatus,
  type ViewState,
} from "../src/shared/contracts";
import { atomicWrite } from "./storage";
import { RecoveryWriter } from "./recovery";
import { FileWorkspace, type FileTab } from "./workspace";
import { errorMessage } from "../src/shared/errors";
import { documentName } from "../src/shared/documentName";

app.setName("Axon");
if (process.env.AXON_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.AXON_TEST_DATA));
let win: BrowserWindow;
let preferences = { ...defaults };
let recents: string[] = [];
const workspace = new FileWorkspace();
let fileBusy = false;
let closing = false;
let ready = false;
let closePending = false;
let settingsQueue: Promise<void> = Promise.resolve();
const dataFile = (name: string) => path.join(app.getPath("userData"), name);
const devURL = process.env.AXON_DEV_URL;
const pageURL = devURL
  ? new URL(devURL).href
  : pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const session = (tab = workspace.active): Session => ({
  ...tab,
  recents,
  preferences,
  tabs: [...workspace.tabs.values()],
  workspaceFolder: workspace.folder,
});
const viewSchema = z
  .object({
    camera: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        zoom: z.number().min(0.1).max(4),
      })
      .strict(),
    selection: z.array(z.string().max(100)).max(10000),
  })
  .strict();
const tabId = (raw: unknown) =>
  raw === undefined ? workspace.activeId : z.string().uuid().parse(raw);
const emitBackup = (status: BackupStatus) => {
  if (win && !win.isDestroyed()) win.webContents.send("axon:backup", status);
};
const recovery = new RecoveryWriter(dataFile("recovery.json"), emitBackup);
async function saveSettings() {
  const snapshot = JSON.stringify({
    preferences,
    recents,
    workspaceFolder: workspace.folder,
  });
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(() => atomicWrite(dataFile("settings.json"), snapshot));
  await settingsQueue;
}
function remember(file: string) {
  recents = [file, ...recents.filter((p) => p !== file)].slice(0, 8);
}
function enqueueBackup() {
  if (!preferences.restoreSession) {
    recovery.cancel();
    emitBackup({ state: "off" });
    return;
  }
  recovery.schedule(() => workspace.snapshot());
}
async function clearRecovery() {
  await recovery.persist(null);
}
async function persistRecovery(exclude = new Set<string>()) {
  await recovery.persist(
    preferences.restoreSession ? () => workspace.snapshot(exclude) : null,
  );
}
async function save(tab: FileTab, as = false): Promise<boolean> {
  const snapshot = tab.document;
  let file = as ? null : tab.path;
  if (file && (await workspace.conflict(tab, file))) {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      message: "Файл изменён извне или удалён",
      detail:
        "Рабочая копия сохранена во вкладке. Сохраните её под другим именем, чтобы не перезаписать внешний файл.",
      buttons: ["Сохранить как…", "Отмена"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) return false;
    file = null;
  }
  if (!file) {
    const result = await dialog.showSaveDialog(win, {
      title: "Сохранить документ Axon",
      defaultPath:
        tab.path ??
        path.join(workspace.folder ?? "", documentName(tab) + ".axon"),
      filters: [{ name: "Документ Axon", extensions: ["axon"] }],
    });
    if (result.canceled || !result.filePath) return false;
    file = result.filePath;
    if (!file.toLowerCase().endsWith(".axon")) file += ".axon";
    if (await workspace.conflict(tab, file))
      throw new Error("Выберите другое имя: исходный файл изменён извне.");
  }
  await workspace.save(tab, file, snapshot);
  remember(tab.path!);
  await saveSettings();
  enqueueBackup();
  return true;
}
async function allowLeave(
  tab: FileTab,
): Promise<"keep" | "discard" | "cancel"> {
  if (!tab.dirty) return "keep";
  const result = await dialog.showMessageBox(win, {
    type: "question",
    title: "Axon",
    message: "Сохранить изменения?",
    detail:
      "Документ «" + documentName(tab) + "» содержит несохранённые изменения.",
    buttons: ["Сохранить", "Не сохранять", "Отмена"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 2) return "cancel";
  if (result.response === 1) return "discard";
  return (await save(tab)) && !tab.dirty ? "keep" : "cancel";
}
function checkSender(event: IpcMainInvokeEvent) {
  if (
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url.split("#")[0] !== pageURL
  )
    throw new Error("Недопустимый отправитель IPC");
}
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    checkSender(event);
    try {
      return await fn(...args);
    } catch (error) {
      throw new Error(
        error instanceof z.ZodError
          ? "Данные имеют неподдерживаемую структуру."
          : errorMessage(error),
        { cause: error },
      );
    }
  });
}
function bytesOf(value: unknown, max = 80e6): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength > max ||
    !value.byteLength
  )
    throw new Error("Недопустимый размер данных");
  return Buffer.from(value);
}
function imageAsset(value: unknown, mime?: unknown): Asset {
  const bytes = bytesOf(value, 20e6);
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    (!png && !jpeg) ||
    (mime && !["image/png", "image/jpeg"].includes(String(mime)))
  )
    throw new Error("Поддерживаются только PNG и JPEG.");
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error("Не удалось прочитать изображение.");
  const { width, height } = image.getSize();
  if (width > 16384 || height > 16384 || width * height > 40e6)
    throw new Error("Изображение слишком большое (не более 40 мегапикселей).");
  const normalized = image.toPNG();
  if (normalized.length > 20e6)
    throw new Error("Изображение после декодирования больше 20 МБ.");
  return {
    id: crypto.randomUUID(),
    mime: "image/png",
    data: normalized.toString("base64"),
    width,
    height,
  };
}
async function initialize() {
  try {
    const state = JSON.parse(await readFile(dataFile("settings.json"), "utf8"));
    preferences = preferencesSchema.parse(state.preferences);
    recents = z.array(z.string().max(4096)).max(8).parse(state.recents);
    workspace.folder = z
      .string()
      .max(4096)
      .nullable()
      .parse(state.workspaceFolder ?? null);
  } catch {
    /* First launch or invalid settings. */
  }
  if (preferences.restoreSession)
    try {
      const raw = JSON.parse(await readFile(dataFile("recovery.json"), "utf8"));
      // Upgrade the former one-document working copy without altering its contents.
      const snapshot = raw.tabs
        ? raw
        : {
            tabs: [
              {
                sessionId: crypto.randomUUID(),
                document: raw.document,
                savedContent: raw.saved,
                path: raw.path,
                fingerprint: null,
              },
            ],
          };
      if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length > 100)
        throw new Error("Недопустимая сессия");
      for (const tab of snapshot.tabs) {
        z.string().uuid().parse(tab.sessionId);
        if (tab.view) tab.view = viewSchema.parse(tab.view);
        tab.fingerprint = z
          .string()
          .length(64)
          .nullable()
          .parse(tab.fingerprint ?? null);
      }
      const dirty = snapshot.tabs.some(
        (t: FileTab) =>
          serializeDocument(parseDocument(t.document)) !==
          serializeDocument(parseDocument(t.savedContent)),
      );
      const choice = dirty
        ? await dialog.showMessageBox(win, {
            type: "question",
            title: "Axon",
            message: "Восстановить последнюю рабочую копию?",
            detail:
              "Будут восстановлены вкладки из последней записанной сессии.",
            buttons: ["Восстановить", "Не восстанавливать"],
            defaultId: 0,
            cancelId: 1,
          })
        : { response: 0 };
      if (choice.response === 0) await workspace.restore(snapshot);
      else await clearRecovery();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        await dialog.showMessageBox(win, {
          type: "warning",
          message: "Рабочую копию не удалось восстановить.",
          detail: "Исходные файлы не изменены. " + String(error),
        });
    }
  const initialPath = process.argv.find((a) =>
    a.toLowerCase().endsWith(".axon"),
  );
  if (initialPath)
    try {
      const tab = await workspace.open(path.resolve(initialPath));
      remember(tab.path!);
    } catch (error) {
      await dialog.showMessageBox(win, {
        type: "error",
        message: "Не удалось открыть документ",
        detail: String(error),
      });
    }
  if (!workspace.tabs.size) workspace.add();
  ready = true;
}
app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "Axon",
    icon: path.join(__dirname, "../dist/icon.png"),
    backgroundColor: "#11151A",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
    cb(false),
  );
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith("file:") ||
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      (!!devURL &&
        (url.startsWith(devURL + "/") ||
          url === devURL ||
          url.startsWith("ws://127.0.0.1:5173/")));
    callback({ cancel: !allowed });
  });
  const send = (command: string) =>
    win.webContents.send("axon:command", command);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "Axon",
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : []),
      {
        label: "Файл",
        submenu: [
          { label: "Новый", click: () => send("new") },
          { label: "Открыть…", click: () => send("open") },
          { label: "Сохранить", click: () => send("save") },
          { label: "Сохранить как…", click: () => send("saveAs") },
          { type: "separator" },
          { role: "quit", label: "Выйти" },
        ],
      },
      {
        label: "Правка",
        submenu: [
          { role: "undo", label: "Отменить" },
          { role: "redo", label: "Повторить" },
          { type: "separator" },
          { role: "cut", label: "Вырезать" },
          { role: "copy", label: "Копировать" },
          { role: "paste", label: "Вставить" },
          { role: "selectAll", label: "Выделить всё" },
        ],
      },
      {
        label: "Вид",
        submenu: [{ role: "togglefullscreen", label: "Полный экран" }],
      },
    ]),
  );
  if (process.platform !== "darwin") win.setMenuBarVisibility(false);
  await initialize();
  handle("axon:init", () => session());
  handle("axon:update", (raw, id, view) => {
    const tab = workspace.update(
      tabId(id),
      parseDocument(raw),
      view === undefined ? undefined : viewSchema.parse(view),
    );
    enqueueBackup();
    return { dirty: tab.dirty };
  });
  handle("axon:activate", (id) => {
    workspace.get(tabId(id));
    workspace.activeId = tabId(id);
    enqueueBackup();
  });
  handle("axon:folder", async (select) => {
    if (select !== undefined) z.boolean().parse(select);
    if (select) {
      const result = await dialog.showOpenDialog(win, {
        title: "Рабочая папка Axon",
        properties: ["openDirectory"],
        defaultPath: workspace.folder ?? undefined,
      });
      if (!result.canceled) {
        workspace.folder = await realpath(result.filePaths[0]);
        await saveSettings();
      }
    }
    workspace.folderFiles = workspace.folder
      ? (await readdir(workspace.folder, { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".axon"))
          .map((e) => path.join(workspace.folder!, e.name))
          .sort()
      : [];
    return {
      path: workspace.folder,
      files: workspace.folderFiles.map((f) => path.basename(f)),
    };
  });
  handle("axon:file", async (command, raw, index, id) => {
    if (fileBusy) throw new Error("Дождитесь завершения файловой операции.");
    fileBusy = true;
    try {
      const cmd = z
        .enum(["new", "open", "save", "saveAs", "recent", "folder"])
        .parse(command);
      const tab = workspace.update(tabId(id), parseDocument(raw));
      if (cmd === "save" || cmd === "saveAs")
        return (await save(tab, cmd === "saveAs")) ? session(tab) : null;
      if (cmd === "new") workspace.add();
      else {
        let file: string;
        if (cmd === "recent" || cmd === "folder") {
          const files = cmd === "recent" ? recents : workspace.folderFiles;
          file =
            files[
              z
                .number()
                .int()
                .min(0)
                .max(files.length - 1)
                .parse(index)
            ];
        } else {
          const result = await dialog.showOpenDialog(win, {
            title: "Открыть документ Axon",
            properties: ["openFile"],
            filters: [{ name: "Документ Axon", extensions: ["axon"] }],
          });
          if (result.canceled) return null;
          file = result.filePaths[0];
        }
        const opened = await workspace.open(file);
        remember(opened.path!);
      }
      await saveSettings();
      enqueueBackup();
      return session();
    } finally {
      fileBusy = false;
    }
  });
  handle("axon:close-tab", async (id, raw) => {
    if (fileBusy) return null;
    fileBusy = true;
    try {
      const tab = workspace.update(tabId(id), parseDocument(raw));
      if ((await allowLeave(tab)) === "cancel") return null;
      await persistRecovery(new Set([tab.sessionId]));
      workspace.remove(tab.sessionId);
      enqueueBackup();
      return session();
    } finally {
      fileBusy = false;
    }
  });
  handle("axon:preferences", async (raw) => {
    preferences = preferencesSchema.parse(raw);
    if (!preferences.restoreSession) recovery.cancel();
    await saveSettings();
    if (!preferences.restoreSession) {
      await clearRecovery();
      if (!preferences.restoreSession) emitBackup({ state: "off" });
    } else enqueueBackup();
  });
  handle("axon:import-image", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Вставить изображение",
      properties: ["openFile"],
      filters: [{ name: "PNG / JPEG", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > 20e6)
      throw new Error("Изображение больше 20 МБ.");
    return imageAsset(await readFile(result.filePaths[0]));
  });
  handle("axon:decode-image", (bytes, mime) => imageAsset(bytes, mime));
  handle("axon:clipboard-read", async () => {
    const text = await clipboard.readText();
    if (text.startsWith("AXON_CLIPBOARD\n"))
      try {
        return { document: parseDocument(text.slice(15)) };
      } catch {
        /* treat malformed own format as plain text */
      }
    for (const item of await clipboard.read())
      for (const mime of ["image/png", "image/jpeg"])
        if (item.types.includes(mime)) {
          const blob = (await item.getType(mime)) as Blob;
          return {
            image: imageAsset(new Uint8Array(await blob.arrayBuffer())),
          };
        }
    return { text: text.slice(0, 20000) };
  });
  handle("axon:clipboard-write", (raw) =>
    clipboard.writeText(
      "AXON_CLIPBOARD\n" + serializeDocument(parseDocument(raw)),
    ),
  );
  handle("axon:clipboard-png", async (raw) => {
    const asset = imageAsset(raw);
    await clipboard.write([
      new ClipboardItem({
        "image/png": new Blob(
          [new Uint8Array(Buffer.from(asset.data, "base64"))],
          { type: "image/png" },
        ),
      }),
    ]);
  });
  handle("axon:export", async (format, raw, title) => {
    const ext = z.enum(["png", "svg", "pdf"]).parse(format);
    const bytes = bytesOf(raw);
    const name = z
      .string()
      .max(200)
      .parse(title)
      .replace(/[<>:"/\\|?*]/g, "_");
    const result = await dialog.showSaveDialog(win, {
      title: "Экспорт схемы",
      defaultPath: `${name}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return false;
    const target = result.filePath.toLowerCase().endsWith("." + ext)
      ? result.filePath
      : result.filePath + "." + ext;
    await atomicWrite(target, bytes);
    return true;
  });
  handle("axon:close", async (raw, updates) => {
    if (closePending || fileBusy) return;
    closePending = true;
    fileBusy = true;
    try {
      if (updates !== undefined) {
        const list = z
          .array(
            z
              .object({
                sessionId: z.string().uuid(),
                document: z.unknown(),
                view: viewSchema,
              })
              .strict(),
          )
          .max(100)
          .parse(updates);
        for (const update of list)
          workspace.update(
            update.sessionId,
            parseDocument(update.document),
            update.view as ViewState,
          );
      } else workspace.update(workspace.activeId, parseDocument(raw));
      const discard = new Set<string>();
      for (const tab of workspace.tabs.values()) {
        const choice = await allowLeave(tab);
        if (choice === "cancel") return;
        if (choice === "discard") discard.add(tab.sessionId);
      }
      await persistRecovery(discard);
      closing = true;
      win.close();
    } finally {
      closePending = false;
      fileBusy = false;
    }
  });
  // Flush the renderer's latest edit before prompting, even inside the debounce window.
  win.on("close", (event) => {
    if (closing || !ready) return;
    event.preventDefault();
    win.webContents.send("axon:command", "close");
  });
  await win.loadURL(pageURL);
  win.show();
});
app.on("window-all-closed", () => app.quit());
