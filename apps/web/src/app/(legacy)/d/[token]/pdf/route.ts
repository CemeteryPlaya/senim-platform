import { sharedPdfResponse } from "@/app/api/documents/shared-pdf";

/**
 * PDF по подписанной ссылке /d/<token>: без входа, пока ссылка действует. Ответ общий с v2 (`sharedPdfResponse`).
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  return sharedPdfResponse(request, ctx);
}
