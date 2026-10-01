import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { errorMessage } from "../src/shared/errors";

export type RegisterHandler = (
  channel: string,
  handler: (...args: unknown[]) => unknown,
) => void;

export function createIpcRegistrar(win: BrowserWindow, pageURL: string) {
  const channels = new Set<string>();
  const checkSender = (event: IpcMainInvokeEvent) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url.split("#")[0] !== pageURL
    )
      throw new Error("Недопустимый отправитель IPC");
  };
  const handle: RegisterHandler = (channel, fn) => {
    if (channels.has(channel))
      throw new Error(`IPC handler already registered: ${channel}`);
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
    channels.add(channel);
  };
  return {
    handle,
    dispose() {
      for (const channel of channels) ipcMain.removeHandler(channel);
      channels.clear();
    },
  };
}
