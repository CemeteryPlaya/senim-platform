import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { RAIL_MODES } from "./modes";
import type { RailMode } from "./rail";

export const RAIL_SETTING_KEY = "payments.rail";
const railModeSchema = z.enum(RAIL_MODES as [RailMode, ...RailMode[]]);

/**
 * Режим оплаты для новых сделок: PAYMENT_RAIL из env; в DEMO_MODE оператор может переопределить
 * его настройкой PlatformSetting["payments.rail"]. Смена режима влияет только на новые сделки.
 */
export async function activeRailMode(): Promise<RailMode> {
  const fallback = env().PAYMENT_RAIL;
  if (!env().DEMO_MODE) return fallback;
  const row = await db.platformSetting.findUnique({ where: { key: RAIL_SETTING_KEY } });
  const parsed = railModeSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : fallback;
}

/** operator → payments: переключатель режима оплаты для демо. Только оператор и только при DEMO_MODE. */
export async function setActiveRailMode(operator: CurrentUser, mode: RailMode): Promise<void> {
  if (operator.role !== "OPERATOR") fail.forbidden();
  if (!env().DEMO_MODE) fail.forbidden(ru.payments.errors.demoOnly);
  const next = railModeSchema.parse(mode);
  await transaction(async (tx) => {
    const before = await tx.platformSetting.findUnique({ where: { key: RAIL_SETTING_KEY } });
    await tx.platformSetting.upsert({
      where: { key: RAIL_SETTING_KEY },
      create: { key: RAIL_SETTING_KEY, value: next },
      update: { value: next },
    });
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "payments.rail.switched",
      entity: { type: "platformSetting", id: RAIL_SETTING_KEY },
      before: { mode: railModeSchema.safeParse(before?.value).data ?? env().PAYMENT_RAIL },
      after: { mode: next },
    });
  });
}
