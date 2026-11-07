export { errorResponse } from "@/platform/http";

/** Показ в браузере или скачивание; имя с кириллицей — через filename* (RFC 6266/5987), ASCII-запасное — document.pdf. */
export function pdfDisposition(fileName: string, download = false): string {
  return `${download ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** ?original=1 — исходный файл (его хэш подписан); иначе подписанная копия с листом подписей. */
export const variantOf = (url: URL) => (url.searchParams.get("original") === "1" ? ("original" as const) : ("signed" as const));
export const isDownload = (url: URL) => url.searchParams.get("download") === "1";

/** Ответ с PDF: без кэша, без сниффинга, хэш подписанного файла — в заголовке. */
export function pdfResponse(pdf: { bytes: Uint8Array; fileName: string; sha256: string }, download: boolean): Response {
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": pdfDisposition(pdf.fileName, download),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Document-SHA256": pdf.sha256,
    },
  });
}
