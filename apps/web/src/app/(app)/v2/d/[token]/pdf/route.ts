import { sharedPdfResponse } from "@/app/api/documents/shared-pdf";

/** PDF по подписанной ссылке /v2/d/<token>: тот же ответ, что у v1. */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  return sharedPdfResponse(request, ctx);
}
