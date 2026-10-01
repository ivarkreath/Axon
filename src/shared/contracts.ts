import { z } from "zod";
import { markerSchema, styleSchema, type AxonDocument, type Asset } from "../model/document";
export const preferencesSchema = z
  .object({
    theme: z.enum(["dark", "light", "system"]),
    reducedMotion: z.boolean(),
    grid: z.enum(["none", "dots", "lines"]),
    snapObjects: z.boolean(),
    snapGrid: z.boolean(),
    restoreSession: z.boolean(),
    styles: z.record(z.string(), styleSchema),
    connector: z
      .object({
        route: z.enum(["straight", "orthogonal", "curved"]),
        arrows: z.enum(["none", "end", "both"]),
        startMarker: markerSchema.optional(),
        endMarker: markerSchema.optional(),
      })
      .default({ route: "orthogonal", arrows: "end" }),
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
  connector: { route: "orthogonal", arrows: "end" },
};
export type Session = {
  sessionId?: string;
  savedContent?: string;
  tabs?: TabSession[];
  workspaceFolder?: string | null;
  document: AxonDocument;
  path: string | null;
  dirty: boolean;
  recents: string[];
  preferences: Preferences;
  recovered: boolean;
};
export type ViewState = {
  camera: { x: number; y: number; zoom: number };
  selection: string[];
};
export type TabSession = {
  sessionId: string;
  untitledName?: string;
  document: AxonDocument;
  path: string | null;
  dirty: boolean;
  savedContent: string;
  recovered: boolean;
  view?: ViewState;
  unavailable?: boolean;
};
export type SessionUpdate = {
  sessionId: string;
  document: AxonDocument;
  view: ViewState;
};
export type FolderListing = { path: string | null; files: string[] };
export type FileCommand =
  "new" | "open" | "save" | "saveAs" | "recent" | "folder";
export type BackupStatus = {
  state: "pending" | "saved" | "error" | "off";
  message?: string;
  time?: string;
};
export interface AxonAPI {
  init(): Promise<Session>;
  updateDocument(
    document: AxonDocument,
    sessionId?: string,
    view?: ViewState,
  ): Promise<{ dirty: boolean }>;
  updateView(sessionId: string, view: ViewState): Promise<void>;
  file(
    command: FileCommand,
    document: AxonDocument,
    recentIndex?: number,
    sessionId?: string,
  ): Promise<Session | null>;
  activateSession(sessionId: string): Promise<void>;
  closeTab(sessionId: string, document: AxonDocument): Promise<Session | null>;
  folder(select?: boolean): Promise<FolderListing>;
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
  close(document: AxonDocument, tabs?: SessionUpdate[]): Promise<void>;
  onBackup(callback: (status: BackupStatus) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
}
declare global {
  interface Window {
    axon: AxonAPI;
  }
}
