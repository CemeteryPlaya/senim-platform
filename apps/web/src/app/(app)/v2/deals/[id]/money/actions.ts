"use server";

import { z } from "zod";
import { formatDateTime } from "@/features/format/format";
import { shareDocument } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { env } from "@/platform/env";
import { v2Href } from "../../../../_shell/paths";

/**
 * «Поделиться» актом или выпиской: подписанная ссылка на документ. Права (сторона сделки) и допустимость (только акт и
 * выписка) проверяет модуль documents; ссылка выпускается каждый раз заново, в аудит пишется выпуск. Модуль отдаёт адрес
 * экрана v1 (`APP_URL/d/<token>`) — здесь он переводится на экран v2 (`/v2/d/<token>`, до этапа 6), абсолютным адресом.
 */
export const shareDocumentAction = action("app.deal.shareDocument", z.strictObject({ documentId: z.string().min(1).max(64) }), async ({ documentId }) => {
  const user = await requireUser();
  const link = await shareDocument(user, documentId);
  const origin = new URL(env().APP_URL).origin;
  return { url: new URL(v2Href(link.url, origin), origin).toString(), expires: formatDateTime(link.expiresAt) };
});
