export { errorResponse } from "@/platform/http";

/** inline-показ PDF; имя с кириллицей — через filename* (RFC 6266/5987), ASCII-запасное — document.pdf. */
export function pdfDisposition(fileName: string): string {
  return `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
