import { Menu, type BrowserWindow } from "electron";

export function installApplicationMenu(win: BrowserWindow) {
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
}
