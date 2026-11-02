import "server-only";
import { z } from "zod";
import { recordAudit } from "@/modules/audit";
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

/**
 * Указать или сменить счёт. Строка профиля берётся FOR UPDATE: параллельная смена ждёт, и «тот же счёт ещё
 * раз» (двойной клик) распознаётся надёжно — журнал второй раз не пишется. Журнал — без значения.
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
