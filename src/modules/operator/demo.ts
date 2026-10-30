import { resetDemo } from "@/demo/seed";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import type { RailMode } from "@/modules/payments";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";
import { assertDemoMode, assertOperator } from "./access";
import { DEMO_RAIL_MODES, type DemoRailMode } from "./schemas";

/**
 * Ключ настройки режима оплаты для новых сделок. Значение — JSON-строка "manual" | "escrow-simulator".
 * INTEGRATOR: payments.activeRailMode() должен читать этот ключ при DEMO_MODE (см. ADR-002);
 * константу стоит перенести в payments и импортировать отсюда.
 */
export const PAYMENTS_RAIL_SETTING = "payments.rail";

const isDemoRail = (v: unknown): v is DemoRailMode => typeof v === "string" && (DEMO_RAIL_MODES as readonly string[]).includes(v);

/** Действующий режим для новых сделок: переопределение оператора (только в DEMO_MODE) или env. */
export async function getPaymentRailSetting(): Promise<{ mode: RailMode; source: "env" | "setting" }> {
  if (env().DEMO_MODE) {
    const setting = await db.platformSetting.findUnique({ where: { key: PAYMENTS_RAIL_SETTING } });
    if (setting && isDemoRail(setting.value)) return { mode: setting.value, source: "setting" };
  }
  return { mode: env().PAYMENT_RAIL, source: "env" };
}

export async function setPaymentRail(user: CurrentUser, input: { mode: DemoRailMode }): Promise<void> {
  assertOperator(user);
  assertDemoMode();
  const before = await getPaymentRailSetting();
  await transaction(async (tx) => {
    await tx.platformSetting.upsert({
      where: { key: PAYMENTS_RAIL_SETTING },
      create: { key: PAYMENTS_RAIL_SETTING, value: input.mode },
      update: { value: input.mode },
    });
    if (before.mode === input.mode) return;
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "settings.payments_rail.changed",
      entity: { type: "setting", id: PAYMENTS_RAIL_SETTING },
      before: { mode: before.mode },
      after: { mode: input.mode },
    });
  });
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
