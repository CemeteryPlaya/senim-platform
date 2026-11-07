import { z } from "zod";
import { ru } from "@/i18n/ru";
import { receiveLocalUpload } from "@/modules/files";
import { requireUser } from "@/modules/identity";
import { errorResponse } from "../http";

const query = z.object({ token: z.string().min(10).max(4000) });

/**
 * Приём байтов для local-хранилища (разработка): цель загрузки из createUpload.
 * s3 и vercel-blob загружают напрямую в хранилище и сюда не приходят.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ code: "VALIDATION", error: ru.files.errors.noUploadToken }, { status: 400 });
    await receiveLocalUpload(user, { token: parsed.data.token, body: request.body });
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e, "files.upload");
  }
}
