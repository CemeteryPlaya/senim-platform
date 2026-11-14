import "server-only";
import type { MasterStatus } from "../../../../_shell/auth";
import { isAppError } from "@/platform/errors";

/**
 * Чтение портфолио. Портфолио открыто и мастеру на проверке, и после отказа (его заполняют до проверки): модуль требует
 * только профиль мастера. Нет профиля (статус «нет» или отказ модуля FORBIDDEN) — экран статуса «нет профиля» вместо
 * ошибки; прочие ошибки — как есть (NOT_FOUND ловит экран работы).
 */
export async function readForOwner<T>(status: MasterStatus, read: () => Promise<T>): Promise<{ gate: "none" } | { data: T }> {
  if (status === "none") return { gate: "none" };
  try {
    return { data: await read() };
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return { gate: "none" };
    throw e;
  }
}
