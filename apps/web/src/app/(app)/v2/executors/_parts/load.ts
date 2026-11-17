import "server-only";
import type { CurrentUser } from "@/modules/identity";
import { getClientRequest } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { invitable, type InviteContext } from "./list-view";

/**
 * Заявка из адреса списка (`?request=`): только своя у вошедшего покупателя, открытая, на всех мастеров и путём ТЗ.
 * Гость, другая роль, чужая или несуществующая заявка (модуль отвечает NOT_FOUND), заявка не в том состоянии — обычный
 * список без ошибки (`null`). Права на заявку проверяет модуль requests (`getClientRequest`).
 */
export async function inviteContext(user: CurrentUser | null, requestId: string | null): Promise<InviteContext | null> {
  if (!user || user.role !== "CLIENT" || !requestId) return null;
  try {
    const request = await getClientRequest(user, requestId);
    return invitable(request) ? { requestId: request.id, number: request.number } : null;
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return null;
    throw e;
  }
}
