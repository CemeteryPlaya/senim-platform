import "server-only";
import { z } from "zod";
import type { PreContractFlow } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { db, transaction, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { DEFAULT_FLOW, PRE_CONTRACT_FLOWS, TZ_PATH, type RequestPath } from "./flows";

/**
 * Настройка «Сценарий до договора» (ADR-005): PlatformSetting["requests.preContractFlow"].
 * Переключает оператор и только в DEMO_MODE; вне демо действует сценарий по умолчанию.
 * Заявка запоминает сценарий при отправке — смена настройки не меняет заявки, которые уже идут.
 */

export const PRE_CONTRACT_FLOW_KEY = "requests.preContractFlow";
export const preContractFlowSchema = z.enum(PRE_CONTRACT_FLOWS);
export const setPreContractFlowSchema = z.strictObject({ flow: preContractFlowSchema });

export async function activePreContractFlow(tx: Db = db): Promise<PreContractFlow> {
  if (!env().DEMO_MODE) return DEFAULT_FLOW;
  const row = await tx.platformSetting.findUnique({ where: { key: PRE_CONTRACT_FLOW_KEY } });
  return preContractFlowSchema.safeParse(row?.value).data ?? DEFAULT_FLOW;
}

/**
 * Путь новой заявки (решение 2.2.9): по умолчанию — путь ТЗ (торг → оферта); сценарий до договора — только
 * при включённом флаге preContractFlows. Запоминается в заявке при отправке.
 */
export async function newRequestPath(tx: Db = db): Promise<RequestPath> {
  return isEnabled("preContractFlows") ? activePreContractFlow(tx) : TZ_PATH;
}

/** Оператор выбирает сценарий для новых заявок. Повтор того же значения ничего не пишет. */
export async function setPreContractFlow(operator: CurrentUser, input: { flow: PreContractFlow }): Promise<void> {
  if (operator.role !== "OPERATOR") fail.forbidden();
  if (!env().DEMO_MODE) fail.forbidden(ru.requests.pre.errors.demoOnly);
  const next = preContractFlowSchema.parse(input.flow);
  await transaction(async (tx) => {
    const before = await activePreContractFlow(tx);
    if (before === next) return;
    await tx.platformSetting.upsert({
      where: { key: PRE_CONTRACT_FLOW_KEY },
      create: { key: PRE_CONTRACT_FLOW_KEY, value: next },
      update: { value: next },
    });
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "requests.pre_contract_flow.switched",
      entity: { type: "platformSetting", id: PRE_CONTRACT_FLOW_KEY },
      before: { flow: before },
      after: { flow: next },
    });
  });
}
