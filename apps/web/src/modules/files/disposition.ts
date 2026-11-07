/** Content-Disposition для скачивания: имя в UTF-8 (RFC 6266) и ASCII-запасной вариант; без имени — показать в браузере. */
export function contentDisposition(fileName: string | undefined): string {
  if (!fileName) return "inline";
  const ext = /\.[a-z0-9]{1,8}$/i.exec(fileName)?.[0] ?? "";
  return `attachment; filename="file${ext}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
