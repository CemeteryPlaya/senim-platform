import "server-only";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { decryptPii, encryptPii, last4 } from "@/platform/crypto";
import { db, transaction, type Db } from "@/platform/db";
import { parseInput } from "@/platform/validation";
import { ownExecutorId } from "./executor-guard";
import { ibanField } from "./iban";
import { actorOf, type CurrentUser } from "./session";

/**
 * Реквизиты выплаты мастера (решение 2.2.8): KZ IBAN с проверкой контрольной суммы на входе, в БД — только
 * зашифрованным (encryptPii, как ИИН), в интерфейсе — последние 4 символа. Значение не пишется ни в журнал,
 * ни в логи; расшифровывает его только payoutRecipientOf — для распоряжения банку о выплате.
 */
export const payoutInputSchema = z.object({ iban: ibanField });
export type PayoutInput = z.input<typeof payoutInputSchema>;
export type OwnPayout = { last4: string | null };

export async function getOwnPayout(user: CurrentUser): Promise<OwnPayout> {
  const executorId = ownExecutorId(user);
  const row = await db.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: { payoutIbanLast4: true } });
  return { last4: row.payoutIbanLast4 };
}

const n = ru.identity.payout.notify;

/** Мастеру и операторам — о новом счёте (последние 4): подмену счёта после захвата входа заметят сразу. */
async function notifyPayoutChanged(tx: Db, user: CurrentUser, executorId: string, first: boolean, ibanLast4: string) {
  await notify(tx, { userId: user.id, kind: "executor.payout_iban_changed", title: n.title(first), body: n.body(ibanLast4), link: "/executor/profile/payout" });
  const { legalName } = await tx.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: { legalName: true } });
  const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
  for (const op of operators) {
    await notify(tx, {
      userId: op.id,
      kind: "executor.payout_iban_changed",
      title: n.title(first),
      body: n.operatorBody(legalName, first, ibanLast4),
      link: `/operator/executors/${executorId}`,
    });
  }
}

/**
 * Указать или сменить счёт. Строка профиля берётся FOR UPDATE: параллельная смена ждёт, и «тот же счёт ещё
 * раз» (двойной клик) распознаётся надёжно — журнал и уведомления второй раз не пишутся. Журнал — без значения.
 * Запрет смены при ждущей выплате (SPLIT_MASTER в PENDING) — не здесь, а в Server Action `savePayoutIban`
 * (payments.assertPayoutIbanChangeable): identity не может зависеть от payments, payments берёт получателя отсюда.
 */
export async function setPayoutIban(user: CurrentUser, raw: PayoutInput): Promise<OwnPayout> {
  const executorId = ownExecutorId(user);
  const { iban } = parseInput(payoutInputSchema, raw);
  return transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ payoutIbanEnc: string | null }[]>`
      SELECT "payoutIbanEnc" FROM "ExecutorProfile" WHERE id = ${executorId} FOR UPDATE`;
    const previous = current?.payoutIbanEnc ? decryptPii(current.payoutIbanEnc) : null;
    if (previous === iban) return { last4: last4(iban) };
    await tx.executorProfile.update({ where: { id: executorId }, data: { payoutIbanEnc: encryptPii(iban), payoutIbanLast4: last4(iban) } });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "executor.payout_iban_changed",
      entity: { type: "executor", id: executorId },
      scope: `executor:${executorId}`,
      before: { set: previous !== null },
      after: { set: true },
    });
    await notifyPayoutChanged(tx, user, executorId, previous === null, last4(iban));
    return { last4: last4(iban) };
  });
}

/**
 * deal-core / payments → identity: получатель выплаты мастеру. Только на сервере, в транзакции распоряжения
 * банку; IBAN не логировать и не возвращать в интерфейс. iban: null — мастер ещё не указал счёт.
 * name — наименование профиля (ТОО/ИП или ФИО самозанятого), как в оферте.
 */
export async function payoutRecipientOf(tx: Db, executorId: string): Promise<{ iban: string | null; name: string }> {
  const row = await tx.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: { payoutIbanEnc: true, legalName: true } });
  return { iban: row.payoutIbanEnc ? decryptPii(row.payoutIbanEnc) : null, name: row.legalName };
}
