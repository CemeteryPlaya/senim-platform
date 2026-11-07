import { ru } from "@/i18n/ru";
import { getDocumentPdf } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { routeId } from "@/platform/http";
import { errorResponse, isDownload, pdfResponse, variantOf } from "../../http";

/**
 * PDF документа сделки. Только стороны сделки и оператор (проверяет documents.getDocumentPdf);
 * чужим — 404, чтобы не раскрывать, что документ существует. Байты исходного файла сверяются с Document.sha256.
 * По умолчанию — подписанная копия (исходный PDF + лист подписей); ?original=1 — исходный файл; ?download=1 — скачать.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const pdf = await getDocumentPdf(user, await routeId(ctx.params, ru.documents.errors.notFound), variantOf(url));
    return pdfResponse(pdf, isDownload(url));
  } catch (e) {
    return errorResponse(e, "documents.pdf");
  }
}
