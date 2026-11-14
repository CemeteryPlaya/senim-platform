import { getSharedDocumentPdf } from "@/modules/documents";
import { errorResponse, isDownload, pdfResponse, variantOf } from "./http";

/**
 * PDF по подписанной ссылке: без входа, пока ссылка действует (HMAC и срок проверяет documents).
 * Общий ответ для маршрута v1 (`/d/<token>/pdf`) и v2 (`/v2/d/<token>/pdf`). Недействительная ссылка — 404.
 * ?original=1 — исходный файл, ?download=1 — скачать.
 */
export async function sharedPdfResponse(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    const { token } = await ctx.params;
    const url = new URL(request.url);
    return pdfResponse(await getSharedDocumentPdf(token, variantOf(url)), isDownload(url));
  } catch (e) {
    return errorResponse(e, "documents.shared.pdf");
  }
}
