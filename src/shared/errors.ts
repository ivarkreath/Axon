/** Keep platform/IPC diagnostics out of user-facing messages. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/^Error: /, "")
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : message.match(/^([A-Z]+):/)?.[1];
  const messages: Record<string, string> = {
    ENOENT: "Файл или папка не найдены. Выберите другое расположение.",
    ENOTDIR: "Это расположение не является папкой. Выберите другую папку.",
    EISDIR: "Выбрана папка вместо файла. Укажите имя файла.",
    EACCES: "Нет доступа к файлу. Проверьте права или выберите другую папку.",
    EPERM: "Операция с файлом запрещена. Проверьте права доступа.",
    ENOSPC: "На диске недостаточно свободного места.",
    EBUSY: "Файл занят другой программой. Закройте его и повторите попытку.",
  };
  return (code && messages[code]) || message;
}
