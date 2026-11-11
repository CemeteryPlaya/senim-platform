import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { notify } from "@/modules/notifications";
import { decryptPii } from "@/platform/crypto";
import { db, transaction, type Db } from "@/platform/db";
import { parseInput } from "@/platform/validation";
import { ownExecutorId } from "./executor-guard";
import { ibanField } from "./iban";
import { ownParty, projectParty } from "./projection";
import { identity } from "./remote";
import { retriedOnce } from "./remote-errors";
import { currentSessionToken, type CurrentUser } from "./session";

/**
 * Реквизиты выплаты мастера (решение 2.2.8): KZ IBAN с проверкой контрольной суммы на входе; хранит его identity
 * (шифртекстом), в старой базе и интерфейсе — последние 4 символа. Значение не пишется ни в журнал, ни в логи.
 * payoutRecipientOf до Task 12 читает прежний шифртекст старой базы (его пишет только демо-сид).
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
 * Указать или сменить счёт (порядок плана 2б: проверка payout-lock — у вызывающего, затем SetPayoutIban, затем проекция).
 * Формат и контрольная сумма проверяются здесь (identity не вызывается с заведомо неверным счётом) и ещё раз в identity.
 * IBAN шифрует и хранит identity, он же пишет журнал (`executor.payout_iban_changed`, без значения); в старой базе —
 * только последние 4 символа. Запрет смены при ждущей выплате (SPLIT_MASTER в PENDING) — не здесь, а в Server Action
 * `savePayoutIban` (payments.assertPayoutIbanChangeable): identity не может зависеть от payments.
 *
 * Уведомления мастеру и операторам — когда identity ответил changed (Ruling V): счёт указан впервые, сменён (даже на счёт с
 * теми же последними 4 символами) или записан поверх нечитаемого. Тот же счёт ещё раз (двойной клик) — changed=false, без
 * уведомлений. «Указан» или «изменён» — по проекции до записи (строка профиля под FOR UPDATE).
 */
export async function setPayoutIban(user: CurrentUser, raw: PayoutInput): Promise<OwnPayout> {
  const executorId = ownExecutorId(user);
  const { iban } = parseInput(payoutInputSchema, raw);
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, iban, idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().setPayoutIban(request));
  const party = ownParty(user.id, res.party);
  return transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ payoutIbanLast4: string | null }[]>`
      SELECT "payoutIbanLast4" FROM "ExecutorProfile" WHERE id = ${executorId} FOR UPDATE`;
    await projectParty(party, tx);
    if (res.changed) await notifyPayoutChanged(tx, user, executorId, (current?.payoutIbanLast4 ?? null) === null, party.payoutIbanLast4);
    return { last4: party.payoutIbanLast4 };
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
