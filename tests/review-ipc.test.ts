import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { createIpcRegistrar, type RegisterHandler } from "../electron/ipc";
import { createMainWindow } from "../electron/window";
import { registerWorkspaceHandlers } from "../electron/workspace-ipc";
import { FileWorkspace } from "../electron/workspace";
import { RecoveryWriter } from "../electron/recovery";

const mocks = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  >();
  const win = {
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      },
    },
  };
  return {
    handlers,
    win,
    BrowserWindow: vi.fn(function (_options: unknown) {
      return win;
    }),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
    handle: vi.fn(
      (
        channel: string,
        handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
      ) => handlers.set(channel, handler),
    ),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
});
vi.mock("electron", () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog,
    showMessageBox: mocks.showMessageBox,
  },
}));
const dirs: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe("review: guarded IPC registration and lifecycle", () => {
  it("checks sender, main frame and exact page URL for every registered handler", async () => {
    const pageURL = "file:///D:/Axon/dist/index.html";
    const frame = { url: pageURL + "#canvas" };
    const win = {
      webContents: { mainFrame: frame },
    } as unknown as BrowserWindow;
    const ipc = createIpcRegistrar(win, pageURL);
    const handler = vi.fn((raw: unknown) => z.string().parse(raw));
    ipc.handle("axon:test", handler);
    const invoke = mocks.handlers.get("axon:test")!;
    const valid = {
      sender: win.webContents,
      senderFrame: frame,
    } as IpcMainInvokeEvent;
    expect(await invoke(valid, "ok")).toBe("ok");
    for (const invalid of [
      { ...valid, sender: {} },
      { ...valid, senderFrame: { url: pageURL } },
      { ...valid, senderFrame: null },
    ])
      await expect(
        invoke(invalid as IpcMainInvokeEvent, "bad"),
      ).rejects.toThrow("Недопустимый отправитель IPC");
    frame.url = "https://example.invalid/";
    await expect(invoke(valid, "bad")).rejects.toThrow(
      "Недопустимый отправитель IPC",
    );
    frame.url = pageURL;
    await expect(invoke(valid, 42)).rejects.toThrow(
      "Данные имеют неподдерживаемую структуру",
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(() => ipc.handle("axon:test", handler)).toThrow(
      "already registered",
    );
    ipc.dispose();
    ipc.dispose();
    expect(mocks.removeHandler).toHaveBeenCalledTimes(1);
    expect(mocks.handlers.size).toBe(0);
  });

  it("retains window isolation, permission denial, popup denial and network restrictions", () => {
    createMainWindow("D:/Axon/dist-electron");
    expect(mocks.BrowserWindow.mock.calls[0][0]).toMatchObject({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    expect(
      mocks.win.webContents.setWindowOpenHandler.mock.calls[0][0](),
    ).toEqual({ action: "deny" });
    const permission = vi.fn();
    mocks.win.webContents.session.setPermissionRequestHandler.mock.calls[0][0](
      null,
      "clipboard-read",
      permission,
    );
    expect(permission).toHaveBeenCalledWith(false);
    const beforeRequest =
      mocks.win.webContents.session.webRequest.onBeforeRequest.mock.calls[0][0];
    for (const [url, cancel] of [
      ["file:///D:/Axon/dist/index.html", false],
      ["data:image/png;base64,a", false],
      ["blob:axon", false],
      ["https://example.invalid/", true],
      ["ws://127.0.0.1:5173/", true],
    ] as const) {
      const reply = vi.fn();
      beforeRequest({ url }, reply);
      expect(reply).toHaveBeenCalledWith({ cancel });
    }
    const event = { preventDefault: vi.fn() };
    mocks.win.webContents.on.mock.calls[0][1](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("backs up the last accepted edit even when Save/Open or Close is canceled, while view-only stays cheap", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "axon-ipc-"));
    dirs.push(directory);
    const win = Object.assign(new EventEmitter(), {
      webContents: { send: vi.fn() },
      close: vi.fn(),
    });
    const workspace = new FileWorkspace();
    const recovery = new RecoveryWriter(
      path.join(directory, "recovery.json"),
      vi.fn(),
    );
    const schedule = vi
      .spyOn(recovery, "schedule")
      .mockImplementation(() => {});
    const handlers = new Map<string, Parameters<RegisterHandler>[1]>();
    const dispose = await registerWorkspaceHandlers(
      (channel, handler) => handlers.set(channel, handler),
      {
        win: win as unknown as BrowserWindow,
        workspace,
        recovery,
        dataFile: (name) => path.join(directory, name),
        emitBackup: vi.fn(),
      },
    );
    const tab = workspace.active;
    await handlers.get("axon:view")!(tab.sessionId, {
      camera: { x: 1, y: 2, zoom: 1 },
      selection: [],
    });
    await handlers.get("axon:activate")!(tab.sessionId);
    expect(schedule).not.toHaveBeenCalled();
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    mocks.showOpenDialog.mockResolvedValue({ canceled: true });
    for (const command of ["save", "open"]) {
      const document = {
        ...tab.document,
        title: `Last edit before ${command}`,
      };
      expect(
        await handlers.get("axon:file")!(
          command,
          document,
          undefined,
          tab.sessionId,
        ),
      ).toBeNull();
      expect(tab.document.title).toBe(document.title);
      expect(tab.dirty).toBe(true);
    }
    mocks.showMessageBox.mockResolvedValue({ response: 2 });
    expect(
      await handlers.get("axon:close-tab")!(tab.sessionId, {
        ...tab.document,
        title: "Last close-tab edit",
      }),
    ).toBeNull();
    await handlers.get("axon:close")!({
      ...tab.document,
      title: "Last window edit",
    });
    expect(tab.document.title).toBe("Last window edit");
    expect(schedule).toHaveBeenCalledTimes(4);
    expect(win.close).not.toHaveBeenCalled();
    expect(win.listenerCount("close")).toBe(1);
    dispose();
    expect(win.listenerCount("close")).toBe(0);
  });
});
