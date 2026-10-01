import { dialog, type BrowserWindow, type Event } from "electron";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseDocument } from "../src/model/document";
import {
  defaults,
  preferencesSchema,
  type Session,
  type BackupStatus,
  type ViewState,
} from "../src/shared/contracts";
import { MAX_DOCUMENT_OBJECTS, MAX_TABS } from "../src/shared/limits";
import { errorMessage } from "../src/shared/errors";
import { documentName } from "../src/shared/documentName";
import { atomicWrite } from "./storage";
import type { RecoveryWriter } from "./recovery";
import type { FileWorkspace, FileTab } from "./workspace";
import type { RegisterHandler } from "./ipc";

type WorkspaceContext = {
  win: BrowserWindow;
  workspace: FileWorkspace;
  recovery: RecoveryWriter;
  dataFile: (name: string) => string;
  emitBackup: (status: BackupStatus) => void;
};

// Session/file IPC shares the existing workspace and recovery writer. This owns
// only application settings and dialog/lifecycle coordination, not document copies.
export async function registerWorkspaceHandlers(
  handle: RegisterHandler,
  { win, workspace, recovery, dataFile, emitBackup }: WorkspaceContext,
) {
  let preferences = { ...defaults };
  let recents: string[] = [];
  let fileBusy = false;
  let closing = false;
  let ready = false;
  let closePending = false;
  let settingsQueue: Promise<void> = Promise.resolve();
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
      selection: z.array(z.string().max(100)).max(MAX_DOCUMENT_OBJECTS),
    })
    .strict();
  const tabId = (raw: unknown) =>
    raw === undefined ? workspace.activeId : z.string().uuid().parse(raw);
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
    const savedPath = await workspace.save(tab, file, snapshot);
    remember(savedPath);
    try {
      await saveSettings();
    } catch (error) {
      // The document write has succeeded; do not report it as unsaved merely
      // because the independent recent-files/settings write failed.
      await dialog.showMessageBox(win, {
        type: "warning",
        message: "Документ сохранён, но список последних файлов не записан",
        detail: errorMessage(error),
      });
    }
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
        "Документ «" +
        documentName(tab) +
        "» содержит несохранённые изменения.",
      buttons: ["Сохранить", "Не сохранять", "Отмена"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (result.response === 2) return "cancel";
    if (result.response === 1) return "discard";
    return (await save(tab)) && !tab.dirty ? "keep" : "cancel";
  }
  async function initialize() {
    try {
      const state = JSON.parse(
        await readFile(dataFile("settings.json"), "utf8"),
      );
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
        const raw = JSON.parse(
          await readFile(dataFile("recovery.json"), "utf8"),
        );
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
        if (!Array.isArray(snapshot.tabs) || snapshot.tabs.length > MAX_TABS)
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
        // Accept/normalize each input once before inspecting saved-state metadata.
        await workspace.restore(snapshot);
        const dirty = [...workspace.tabs.values()].some((tab) => tab.dirty);
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
        if (choice.response !== 0) {
          workspace.tabs.clear();
          workspace.activeId = "";
          await clearRecovery();
        }
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
  });
  handle("axon:view", (id, raw) => {
    workspace.updateView(tabId(id), viewSchema.parse(raw));
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
      enqueueBackup();
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
      enqueueBackup();
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
          .max(MAX_TABS)
          .parse(updates);
        for (const update of list)
          workspace.update(
            update.sessionId,
            parseDocument(update.document),
            update.view as ViewState,
          );
      } else workspace.update(workspace.activeId, parseDocument(raw));
      enqueueBackup();
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
  const onClose = (event: Event) => {
    if (closing || !ready) return;
    event.preventDefault();
    win.webContents.send("axon:command", "close");
  };
  win.on("close", onClose);
  return () => win.off("close", onClose);
}
