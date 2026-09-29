import { z } from "zod";
import { styleSchema, type AxonDocument, type Asset } from "../model/document";
export const preferencesSchema = z
  .object({
    theme: z.enum(["dark", "light", "system"]),
    reducedMotion: z.boolean(),
    grid: z.enum(["none", "dots", "lines"]),
    snapObjects: z.boolean(),
    snapGrid: z.boolean(),
    restoreSession: z.boolean(),
    styles: z.record(z.string(), styleSchema),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults: Preferences = {
  theme: "dark",
  reducedMotion: false,
  grid: "dots",
  snapObjects: true,
  snapGrid: false,
  restoreSession: true,
  styles: {},
};
export type Session = {
  document: AxonDocument;
  path: string | null;
  dirty: boolean;
  recents: string[];
  preferences: Preferences;
  recovered: boolean;
};
export type FileCommand = "new" | "open" | "save" | "saveAs" | "recent";
export type BackupStatus = {
  state: "pending" | "saved" | "error" | "off";
  message?: string;
  time?: string;
};
export interface AxonAPI {
  init(): Promise<Session>;
  updateDocument(document: AxonDocument): Promise<{ dirty: boolean }>;
  file(
    command: FileCommand,
    document: AxonDocument,
    recentIndex?: number,
  ): Promise<Session | null>;
  preferences(preferences: Preferences): Promise<void>;
  importImage(): Promise<Asset | null>;
  decodeImage(bytes: Uint8Array, mime: string): Promise<Asset>;
  readClipboard(): Promise<{
    document?: AxonDocument;
    image?: Asset;
    text?: string;
  }>;
  writeClipboard(document: AxonDocument): Promise<void>;
  writePNG(bytes: Uint8Array): Promise<void>;
  exportFile(
    format: "png" | "svg" | "pdf",
    bytes: Uint8Array,
    title: string,
  ): Promise<boolean>;
  close(document: AxonDocument): Promise<void>;
  onBackup(callback: (status: BackupStatus) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
}
declare global {
  interface Window {
    axon: AxonAPI;
  }
}
