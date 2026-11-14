import "server-only";
import { getMyRegistration, type CurrentUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";
import type { MasterStatus } from "../../../_shell/auth";
import type { GateStatus } from "./MasterGate";

/** Статус для экрана статуса по свежему чтению профиля (не по сессии). Одобрен — значит гонка уже прошла: «на проверке». */
async function freshGate(user: CurrentUser): Promise<GateStatus> {
  const registration = await getMyRegistration(user);
  if (registration === null) return "none";
  return registration.status === "REJECTED" ? "rejected" : "pending";
}

/**
 * Чтение для одобренного мастера. Статус из сессии — подсказка экрану; одобрение проверяет модуль по базе (`notApproved`,
 * FORBIDDEN). Расхождение возможно только в гонке: оператор снял одобрение или изменил статус между входом и открытием
 * экрана. Тогда вместо ошибки показывается экран статуса, а сам статус берётся из свежего чтения профиля (отказ остаётся
 * отказом, а не «на проверке»). Прочие ошибки пробрасываются.
 */
export async function readForMaster<T>(user: CurrentUser, status: MasterStatus, read: () => Promise<T>): Promise<{ gate: GateStatus } | { data: T }> {
  if (status !== "approved") return { gate: status };
  try {
    return { data: await read() };
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return { gate: await freshGate(user) };
    throw e;
  }
}
