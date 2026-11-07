import { isDownload, pdfResponse, variantOf } from "@/app/api/documents/http";
import { getSharedDocumentPdf } from "@/modules/documents";
import { errorResponse } from "@/platform/http";

/**
 * PDF по подписанной ссылке /d/<token>: без входа, пока ссылка действует (HMAC и срок проверяет documents).
 * Недействительная ссылка — 404. ?original=1 — исходный файл, ?download=1 — скачать.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const url = new URL(request.url);
    return pdfResponse(await getSharedDocumentPdf(token, variantOf(url)), isDownload(url));
  } catch (e) {
    return errorResponse(e, "documents.shared.pdf");
  }
}
