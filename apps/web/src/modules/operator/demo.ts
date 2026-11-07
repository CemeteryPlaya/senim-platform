import { resetDemo } from "@/demo/seed";
import { recordAudit, SYSTEM } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";
import { assertDemoMode, assertOperator } from "./access";

/**
 * «Сбросить демо»: TRUNCATE всех таблиц и сид заново (src/demo/seed.ts). Сессии тоже очищаются —
 * все, включая оператора, выходят; экран после этого ведёт на выбор демо-персоны.
 * Журнал очищается вместе с данными, поэтому событие сброса пишется уже в новый журнал от имени системы.
 */
export async function resetDemoData(user: CurrentUser): Promise<void> {
  assertOperator(user);
  assertDemoMode();
  const summary = await resetDemo(db);
  await recordAudit(db, {
    actor: SYSTEM("operator.resetDemo"),
    action: "demo.reset",
    entity: { type: "demo", id: "seed" },
    meta: { requestedBy: user.fullName ?? user.id, ...summary },
  });
  logger.info("demo reset", { operatorId: user.id, ...summary });
}
