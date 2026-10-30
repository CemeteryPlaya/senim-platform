import { z } from "zod";
import { ru } from "@/i18n/ru";
import { getDocumentPdf } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { errorResponse, pdfDisposition } from "../../http";

const params = z.object({ id: z.string().min(1).max(64) });

/**
 * PDF договора или акта. Только стороны сделки и оператор (проверяет documents.getDocumentPdf);
 * чужим — 404, чтобы не раскрывать, что документ существует. Байты сверяются с Document.sha256.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const parsed = params.safeParse(await ctx.params);
    if (!parsed.success) return Response.json({ code: "NOT_FOUND", error: ru.documents.errors.notFound }, { status: 404 });
    const pdf = await getDocumentPdf(user, parsed.data.id);
    return new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": pdfDisposition(pdf.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Document-SHA256": pdf.sha256,
      },
    });
  } catch (e) {
    return errorResponse(e, "documents.pdf");
  }
}
