import { BrowserWindow } from "electron";
import path from "node:path";

export function createMainWindow(directory: string, devURL?: string) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "Axon",
    icon: path.join(directory, "../dist/icon.png"),
    backgroundColor: "#11151A",
    show: false,
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
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
  return win;
}
