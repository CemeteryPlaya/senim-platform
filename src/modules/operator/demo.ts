import { resetDemo } from "@/demo/seed";
import { recordAudit, SYSTEM } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import { activeRailMode, RAIL_SETTING_KEY, setActiveRailMode, type RailMode } from "@/modules/payments";
import { db } from "@/platform/db";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";
import { assertDemoMode, assertOperator } from "./access";
import type { DemoRailMode } from "./schemas";

/**
 * Действующий режим оплаты для новых сделок (решает payments.activeRailMode) и откуда он:
 * переопределение оператора в PlatformSetting (только DEMO_MODE) или env.
 */
export async function getPaymentRailSetting(): Promise<{ mode: RailMode; source: "env" | "setting" }> {
  const mode = await activeRailMode();
  const overridden = env().DEMO_MODE && (await db.platformSetting.count({ where: { key: RAIL_SETTING_KEY } })) > 0;
  return { mode, source: overridden ? "setting" : "env" };
}

/** Переключатель режима оплаты для демо: проверки и аудит — в payments.setActiveRailMode. */
export async function setPaymentRail(user: CurrentUser, input: { mode: DemoRailMode }): Promise<void> {
  assertOperator(user);
  assertDemoMode();
  await setActiveRailMode(user, input.mode);
}

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
