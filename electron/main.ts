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
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  emptyDocument,
  parseDocument,
  serializeDocument,
  type Asset,
} from "../src/model/document";
import {
  defaults,
  preferencesSchema,
  type Session,
  type BackupStatus,
} from "../src/shared/contracts";
import { atomicWrite, readDocument, writeDocument } from "./storage";
import { errorMessage } from "../src/shared/errors";

app.setName("Axon");
if (process.env.AXON_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.AXON_TEST_DATA));
let win: BrowserWindow;
let preferences = { ...defaults };
let recents: string[] = [];
let document = emptyDocument();
let currentPath: string | null = null;
let saved = serializeDocument(document);
let recovered = false;
let closing = false;
let ready = false;
let closePending = false;
let backupTimer: ReturnType<typeof setTimeout> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let settingsQueue: Promise<void> = Promise.resolve();
const dataFile = (name: string) => path.join(app.getPath("userData"), name);
const devURL = process.env.AXON_DEV_URL;
const pageURL = devURL
  ? new URL(devURL).href
  : pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const session = (): Session => ({
  document,
  path: currentPath,
  dirty: serializeDocument(document) !== saved,
  recents,
  preferences,
  recovered,
});
const emitBackup = (status: BackupStatus) => {
  if (win && !win.isDestroyed()) win.webContents.send("axon:backup", status);
};
async function saveSettings() {
  const snapshot = JSON.stringify({ preferences, recents });
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(() => atomicWrite(dataFile("settings.json"), snapshot));
  await settingsQueue;
}
function remember(file: string) {
  recents = [file, ...recents.filter((p) => p !== file)].slice(0, 8);
}
function enqueueBackup() {
  clearTimeout(backupTimer);
  if (!preferences.restoreSession) {
    emitBackup({ state: "off" });
    return;
  }
  emitBackup({ state: "pending" });
  backupTimer = setTimeout(() => {
    const snapshot = JSON.stringify({
      document,
      path: currentPath,
      saved,
      at: new Date().toISOString(),
    });
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => atomicWrite(dataFile("recovery.json"), snapshot));
    writeQueue.then(
      () => emitBackup({ state: "saved", time: new Date().toISOString() }),
      () =>
        emitBackup({
          state: "error",
          message: "Не удалось записать рабочую копию",
        }),
    );
  }, 800);
}
async function clearRecovery() {
  clearTimeout(backupTimer);
  await writeQueue.catch(() => {});
  await rm(dataFile("recovery.json"), { force: true });
}
async function save(as = false): Promise<boolean> {
  let file = currentPath;
  if (as || !file) {
    const result = await dialog.showSaveDialog(win, {
      title: "Сохранить документ Axon",
      defaultPath: file ?? `${document.title}.axon`,
      filters: [{ name: "Документ Axon", extensions: ["axon"] }],
    });
    if (result.canceled || !result.filePath) return false;
    file = result.filePath;
    if (!file.toLowerCase().endsWith(".axon")) file += ".axon";
  }
  const snapshot = document;
  await writeDocument(file, snapshot);
  saved = serializeDocument(snapshot);
  currentPath = file;
  remember(file);
  await saveSettings();
  enqueueBackup();
  return true;
}
async function allowLeave(): Promise<boolean> {
  if (serializeDocument(document) === saved) return true;
  const result = await dialog.showMessageBox(win, {
    type: "question",
    title: "Axon",
    message: "Сохранить изменения?",
    detail: `Документ «${document.title}» содержит несохранённые изменения.`,
    buttons: ["Сохранить", "Не сохранять", "Отмена"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 2) return false;
  if (result.response === 0) return save();
  return true;
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
  } catch {
    /* First launch or invalid preferences: safe defaults. */
  }
  if (preferences.restoreSession)
    try {
      const raw = JSON.parse(await readFile(dataFile("recovery.json"), "utf8"));
      const restored = parseDocument(raw.document);
      const savedDocument = parseDocument(raw.saved);
      const dirty =
        serializeDocument(restored) !== serializeDocument(savedDocument);
      const choice = dirty
        ? await dialog.showMessageBox(win, {
            type: "question",
            title: "Axon",
            message: "Восстановить последнюю рабочую копию?",
            detail:
              "Будут доступны только изменения, записанные на диск до завершения предыдущей сессии.",
            buttons: ["Восстановить", "Не восстанавливать"],
            defaultId: 0,
            cancelId: 1,
          })
        : { response: 0 };
      if (choice.response === 0) {
        document = restored;
        saved = serializeDocument(savedDocument);
        currentPath = typeof raw.path === "string" ? raw.path : null;
        recovered = dirty;
      } else await clearRecovery();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await dialog.showMessageBox(win, {
          type: "warning",
          message: "Рабочую копию не удалось восстановить.",
          detail: "Исходные файлы не изменены. " + String(error),
        });
      }
    }
  const initialPath = process.argv.find((a) =>
    a.toLowerCase().endsWith(".axon"),
  );
  if (initialPath)
    try {
      document = await readDocument(path.resolve(initialPath));
      currentPath = path.resolve(initialPath);
      saved = serializeDocument(document);
      remember(currentPath);
    } catch (error) {
      await dialog.showMessageBox(win, {
        type: "error",
        message: "Не удалось открыть документ",
        detail: String(error),
      });
    }
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
  handle("axon:update", (raw) => {
    document = parseDocument(raw);
    enqueueBackup();
    return { dirty: serializeDocument(document) !== saved };
  });
  handle("axon:file", async (command, raw, index) => {
    const cmd = z
      .enum(["new", "open", "save", "saveAs", "recent"])
      .parse(command);
    document = parseDocument(raw);
    if (cmd === "save" || cmd === "saveAs")
      return (await save(cmd === "saveAs")) ? session() : null;
    let next = emptyDocument();
    let nextPath: string | null = null;
    if (cmd === "open" || cmd === "recent") {
      if (cmd === "recent") {
        const i = z
          .number()
          .int()
          .min(0)
          .max(recents.length - 1)
          .parse(index);
        nextPath = recents[i];
      } else {
        const result = await dialog.showOpenDialog(win, {
          title: "Открыть документ Axon",
          properties: ["openFile"],
          filters: [{ name: "Документ Axon", extensions: ["axon"] }],
        });
        if (result.canceled) return null;
        nextPath = result.filePaths[0];
      }
      next = await readDocument(nextPath!);
    }
    if (!(await allowLeave())) return null;
    await clearRecovery();
    document = next;
    currentPath = nextPath;
    saved = serializeDocument(document);
    recovered = false;
    if (nextPath) remember(nextPath);
    await saveSettings();
    enqueueBackup();
    return session();
  });
  handle("axon:preferences", async (raw) => {
    preferences = preferencesSchema.parse(raw);
    await saveSettings();
    if (!preferences.restoreSession) {
      await clearRecovery();
      emitBackup({ state: "off" });
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
  handle("axon:close", async (raw) => {
    if (closePending) return;
    closePending = true;
    try {
      document = parseDocument(raw);
      if (!(await allowLeave())) return;
      await clearRecovery();
      if (preferences.restoreSession && currentPath)
        await atomicWrite(
          dataFile("recovery.json"),
          JSON.stringify({
            document: parseDocument(saved),
            path: currentPath,
            saved,
            at: new Date().toISOString(),
          }),
        );
      closing = true;
      win.close();
    } finally {
      closePending = false;
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
