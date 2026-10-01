import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BackupStatus } from "../src/shared/contracts";
import { FileWorkspace } from "./workspace";
import { RecoveryWriter } from "./recovery";
import { createMainWindow } from "./window";
import { installApplicationMenu } from "./menu";
import { createIpcRegistrar } from "./ipc";
import { registerWorkspaceHandlers } from "./workspace-ipc";
import { registerMediaHandlers } from "./media-ipc";

app.setName("Axon");
if (process.env.AXON_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.AXON_TEST_DATA));
const dataFile = (name: string) => path.join(app.getPath("userData"), name);
const devURL = process.env.AXON_DEV_URL;
const pageURL = devURL
  ? new URL(devURL).href
  : pathToFileURL(path.join(__dirname, "../dist/index.html")).href;

app.whenReady().then(async () => {
  const win = createMainWindow(__dirname, devURL);
  const workspace = new FileWorkspace();
  const emitBackup = (status: BackupStatus) => {
    if (!win.isDestroyed()) win.webContents.send("axon:backup", status);
  };
  const recovery = new RecoveryWriter(dataFile("recovery.json"), emitBackup);
  const ipc = createIpcRegistrar(win, pageURL);
  installApplicationMenu(win);
  const disposeWorkspace = await registerWorkspaceHandlers(ipc.handle, {
    win,
    workspace,
    recovery,
    dataFile,
    emitBackup,
  });
  registerMediaHandlers(ipc.handle, win);
  win.once("closed", () => {
    disposeWorkspace();
    ipc.dispose();
    recovery.cancel();
  });
  await win.loadURL(pageURL);
  win.show();
});
app.on("window-all-closed", () => app.quit());
