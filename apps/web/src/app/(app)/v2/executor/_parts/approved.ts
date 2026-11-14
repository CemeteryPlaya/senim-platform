import "server-only";
import { isAppError } from "@/platform/errors";
import type { MasterStatus } from "../../../_shell/auth";
import type { GateStatus } from "./MasterGate";

/**
 * Чтение для одобренного мастера. Статус из сессии — подсказка экрану; одобрение проверяет модуль по базе (`notApproved`,
 * FORBIDDEN). Оператор мог снять одобрение между входом и открытием экрана — тогда вместо ошибки показывается экран
 * статуса. Прочие ошибки пробрасываются.
 */
export async function readForMaster<T>(status: MasterStatus, read: () => Promise<T>): Promise<{ gate: GateStatus } | { data: T }> {
  if (status !== "approved") return { gate: status };
  try {
    return { data: await read() };
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return { gate: "pending" };
    throw e;
  }
}
