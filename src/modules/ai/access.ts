import type { RequestStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";

/**
 * Права на ИИ-функции заявки. Заявку ведёт модуль requests; здесь только чтение владельца и статуса.
 * Исполнителям ИИ-функции не доступны, поэтому правило видимости исполнителю (requests/visibility) не нужно.
 */

/** Заказчик — только своя заявка (чужая выглядит как несуществующая); оператор — любая. */
export async function readableRequest(user: CurrentUser, requestId: string) {
  if (user.role !== "CLIENT" && user.role !== "OPERATOR") return fail.forbidden();
  const request = await db.request.findFirst({
    where: { id: requestId, ...(user.role === "CLIENT" && { clientId: user.id }) },
    select: { id: true, clientId: true, status: true },
  });
  return request ?? fail.notFound();
}

/** Менять заявку с помощью ИИ может только её заказчик и только в разрешённых статусах. */
export async function ownRequestIn(user: CurrentUser, requestId: string, statuses: readonly RequestStatus[], message: string) {
  if (user.role !== "CLIENT") return fail.forbidden();
  const request = await readableRequest(user, requestId);
  if (!statuses.includes(request.status)) return fail.conflict(message);
  return request;
}
