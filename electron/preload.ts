import { contextBridge, ipcRenderer } from "electron";
import type { AxonAPI, BackupStatus } from "../src/shared/contracts";
import { errorMessage } from "../src/shared/errors";
const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    throw new Error(errorMessage(error), { cause: error });
  });
const api: AxonAPI = {
  init: () => invoke("axon:init"),
  updateDocument: (doc) => invoke("axon:update", doc),
  file: (command, doc, index) => invoke("axon:file", command, doc, index),
  preferences: (prefs) => invoke("axon:preferences", prefs),
  importImage: () => invoke("axon:import-image"),
  decodeImage: (bytes, mime) => invoke("axon:decode-image", bytes, mime),
  readClipboard: () => invoke("axon:clipboard-read"),
  writeClipboard: (doc) => invoke("axon:clipboard-write", doc),
  writePNG: (bytes) => invoke("axon:clipboard-png", bytes),
  exportFile: (format, bytes, title) =>
    invoke("axon:export", format, bytes, title),
  close: (doc) => invoke("axon:close", doc),
  onBackup: (callback) => {
    const listener = (_: unknown, status: BackupStatus) => callback(status);
    ipcRenderer.on("axon:backup", listener);
    return () => ipcRenderer.removeListener("axon:backup", listener);
  },
  onCommand: (callback) => {
    const listener = (_: unknown, command: string) => callback(command);
    ipcRenderer.on("axon:command", listener);
    return () => ipcRenderer.removeListener("axon:command", listener);
  },
};
contextBridge.exposeInMainWorld("axon", api);
