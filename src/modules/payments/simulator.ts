import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertAmount } from "./operations";
import { escrowSimulator, type SignedDelivery } from "./rails/escrow-simulator";

const accountId = z.string().trim().min(1).max(64);
export const simulatorAccountSchema = z.object({ accountId });
export const simulatorDepositSchema = z.object({
  accountId,
  amount: z.coerce.number({ error: ru.payments.errors.depositAmount }).int(ru.payments.errors.depositAmount).positive(ru.payments.errors.depositAmount),
});

/**
 * Экран «Банк-симулятор»: счёт сделки глазами банка. Видят стороны сделки и оператор,
 * пополняет только заказчик. Только для сделок в режиме ESCROW_SIMULATOR.
 */
async function loadAccount(user: CurrentUser, accountId: string) {
  const account = await db.escrowAccount.findUnique({
    where: { id: accountId },
    include: { deal: { select: { id: true, number: true, totalAmount: true, clientId: true, executorId: true, status: true } } },
  });
  const isParty =
    account &&
    (user.role === "OPERATOR" || account.deal.clientId === user.id || (user.executor !== null && account.deal.executorId === user.executor.id));
  if (!account || !isParty) return fail.notFound(ru.payments.errors.accountNotFound);
  if (account.rail !== "ESCROW_SIMULATOR") return fail.notFound(ru.payments.simulator.unavailable);
  return account;
}

export async function getSimulatorAccount(user: CurrentUser, accountId: string) {
  const account = await loadAccount(user, accountId);
  const book = await escrowSimulator.account(account.externalId);
  return {
    accountId: account.id,
    externalId: account.externalId,
    status: account.status,
    deal: { id: account.deal.id, number: account.deal.number, totalAmount: account.deal.totalAmount, status: account.deal.status },
    requisites: book.requisites,
    balance: book.entries.reduce((sum, e) => (e.kind === "DEPOSIT" ? sum + e.amount : sum - e.amount), 0),
    statement: book.entries.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })).reverse(),
    canDeposit: user.role === "CLIENT" && account.deal.clientId === user.id,
    hasEvents: book.events.length > 0,
  };
}

/** Заказчик «пополняет» счёт в симуляторе. Возвращает подписанный вебхук — его доставляет вызывающий. */
export async function simulatorDeposit(user: CurrentUser, input: { accountId: string; amount: number }): Promise<SignedDelivery> {
  const account = await loadAccount(user, input.accountId);
  if (user.role !== "CLIENT" || account.deal.clientId !== user.id) return fail.forbidden(ru.payments.errors.simulatorOnly);
  assertAmount(input.amount, account.deal.totalAmount);
  return escrowSimulator.deposit(account.externalId, input.amount);
}

/** Повторная доставка последнего вебхука — показать, что повтор не меняет сделку. */
export async function simulatorRedeliver(user: CurrentUser, input: { accountId: string }): Promise<SignedDelivery | null> {
  const account = await loadAccount(user, input.accountId);
  return escrowSimulator.redeliverLast(account.externalId);
}
