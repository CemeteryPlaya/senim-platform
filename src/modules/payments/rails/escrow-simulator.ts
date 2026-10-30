import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { sha256Hex } from "@/platform/crypto";
import { db, type Prisma } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { OperationResult, PaymentRail, RailWebhookEvent, Requisites, StatementEntry } from "../rail";
import { signWebhook, verifyWebhookSignature } from "../webhook-signature";

/**
 * Банк-симулятор для показа полного цикла эскроу. Честно подписан в интерфейсе как симулятор.
 *
 * «Книги банка» живут отдельно от журнала платформы (PaymentOperation): в PlatformSetting
 * под ключом «escrow-simulator:account:<номер счёта>». Поэтому сверка (reconcile) сравнивает
 * два независимых источника, как с настоящим банком.
 * INTEGRATOR: при желании вынести книги в отдельную таблицу EscrowSimulatorEntry (см. отчёт).
 *
 * Банк идемпотентен по idempotencyKey: повтор раскрытия транша возвращает ту же операцию.
 * Пополнение приходит только вебхуком, подписанным HMAC.
 */

const KEY_PREFIX = "escrow-simulator:account:";

// Без ESCROW_SIMULATOR_WEBHOOK_SECRET (только не в production) — случайный секрет процесса:
// симулятор подписывает и проверяет вебхуки в одном процессе, а подделать подпись снаружи нельзя.
let processSecret: string | undefined;

const kindSchema = z.enum(["DEPOSIT", "RELEASE", "REFUND"]);
const eventTypeSchema = z.enum(["DEPOSIT_RECEIVED", "RELEASE_COMPLETED", "REFUND_COMPLETED", "OPERATION_FAILED"]);

const entrySchema = z.object({
  externalRef: z.string(),
  kind: kindSchema,
  amount: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  idempotencyKey: z.string().optional(),
});

/** Тело вебхука симулятора. Его же разбирает parseWebhook. */
const webhookBodySchema = z.object({
  eventId: z.string().min(1),
  type: eventTypeSchema,
  externalId: z.string().min(1),
  amount: z.number().int().positive(),
  operationRef: z.string().optional(),
  occurredAt: z.iso.datetime(),
});

const requisitesSchema = z.object({
  bankName: z.string(),
  bik: z.string(),
  iban: z.string(),
  beneficiary: z.string(),
  paymentPurpose: z.string(),
});

const accountSchema = z.object({
  externalId: z.string(),
  dealId: z.string(),
  dealNumber: z.number().int(),
  expectedAmount: z.number().int(),
  requisites: requisitesSchema,
  entries: z.array(entrySchema),
  events: z.array(webhookBodySchema),
});

export type SimulatorAccount = z.infer<typeof accountSchema>;
export type SignedDelivery = { headers: Record<string, string>; rawBody: string; eventId: string };

const keyOf = (externalId: string) => KEY_PREFIX + externalId;
const opRef = () => `SIMOP-${randomBytes(5).toString("hex").toUpperCase()}`;

function webhookSecret(): string {
  const secret = env().ESCROW_SIMULATOR_WEBHOOK_SECRET;
  if (secret) return secret;
  if (env().NODE_ENV === "production") return fail.unavailable(ru.payments.errors.railUnavailable);
  processSecret ??= randomBytes(32).toString("hex");
  return processSecret;
}

/** Учебный IBAN: формат казахстанского счёта, код банка 999 — заведомо не настоящий. */
function simulatorIban(dealNumber: number, salt: string): string {
  const digits = (String(dealNumber).padStart(6, "0") + parseInt(salt.slice(0, 6), 16).toString().padStart(7, "0")).slice(0, 13);
  return `KZ00999${digits}`;
}

async function readAccount(externalId: string): Promise<SimulatorAccount> {
  const row = await db.platformSetting.findUnique({ where: { key: keyOf(externalId) } });
  if (!row) return fail.notFound(ru.payments.errors.accountNotFound);
  return accountSchema.parse(row.value);
}

/** Изменение книги счёта под блокировкой строки: параллельные операции идут по очереди. */
async function mutateAccount<T>(externalId: string, change: (acc: SimulatorAccount) => { account?: SimulatorAccount; result: T }) {
  return db.$transaction(async (tx) => {
    const key = keyOf(externalId);
    await tx.$queryRaw`SELECT "key" FROM "PlatformSetting" WHERE "key" = ${key} FOR UPDATE`;
    const row = await tx.platformSetting.findUnique({ where: { key } });
    if (!row) return fail.notFound(ru.payments.errors.accountNotFound);
    const { account, result } = change(accountSchema.parse(row.value));
    if (account) await tx.platformSetting.update({ where: { key }, data: { value: account as Prisma.InputJsonValue } });
    return result;
  });
}

const balanceOf = (acc: SimulatorAccount) =>
  acc.entries.reduce((sum, e) => (e.kind === "DEPOSIT" ? sum + e.amount : sum - e.amount), 0);

/** Списание со счёта (транш или возврат): идемпотентно по ключу, без ухода в минус. */
function debit(externalId: string, kind: "RELEASE" | "REFUND", amount: number, idempotencyKey: string) {
  return mutateAccount<OperationResult>(externalId, (acc) => {
    const done = acc.entries.find((e) => e.idempotencyKey === idempotencyKey);
    if (done) return { result: { status: "SUCCEEDED", externalRef: done.externalRef } };
    if (balanceOf(acc) < amount) return { result: { status: "FAILED", error: ru.payments.errors.insufficientFunds } };
    const entry = { externalRef: opRef(), kind, amount, occurredAt: new Date().toISOString(), idempotencyKey };
    return { account: { ...acc, entries: [...acc.entries, entry] }, result: { status: "SUCCEEDED", externalRef: entry.externalRef } };
  });
}

function sign(event: z.infer<typeof webhookBodySchema>): SignedDelivery {
  const rawBody = JSON.stringify(event);
  return { headers: signWebhook(webhookSecret(), rawBody), rawBody, eventId: event.eventId };
}

export const escrowSimulatorRail: PaymentRail = {
  mode: "escrow-simulator",
  requiresDeposit: true,

  async openAccount({ dealId, dealNumber, amount }) {
    const salt = sha256Hex(dealId);
    const externalId = `SIM-${dealNumber}-${salt.slice(0, 6).toUpperCase()}`;
    const requisites: Requisites = {
      bankName: ru.payments.simulator.title,
      bik: "SIMKZ999",
      iban: simulatorIban(dealNumber, salt),
      beneficiary: ru.payments.simulator.accountFor(dealNumber),
      paymentPurpose: ru.payments.simulator.accountFor(dealNumber),
    };
    const fresh: SimulatorAccount = { externalId, dealId, dealNumber, expectedAmount: amount, requisites, entries: [], events: [] };
    // Повторное открытие (тот же dealId) возвращает тот же счёт.
    await db.platformSetting.upsert({
      where: { key: keyOf(externalId) },
      create: { key: keyOf(externalId), value: fresh as Prisma.InputJsonValue },
      update: {},
    });
    const stored = await readAccount(externalId);
    return { externalId, requisites: stored.requisites };
  },

  async getRequisites(externalId) {
    return (await readAccount(externalId)).requisites;
  },

  releaseTranche: ({ externalId, amount, idempotencyKey }) => debit(externalId, "RELEASE", amount, idempotencyKey),
  refund: ({ externalId, amount, idempotencyKey }) => debit(externalId, "REFUND", amount, idempotencyKey),

  async getStatement(externalId): Promise<StatementEntry[]> {
    const acc = await readAccount(externalId);
    return acc.entries.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) }));
  },

  async parseWebhook({ headers, rawBody }): Promise<RailWebhookEvent> {
    if (!verifyWebhookSignature(webhookSecret(), headers, rawBody)) return fail.unauthenticated(ru.payments.errors.badSignature);
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return fail.validation(ru.payments.errors.badPayload);
    }
    const parsed = webhookBodySchema.safeParse(json);
    if (!parsed.success) return fail.validation(ru.payments.errors.badPayload);
    return { ...parsed.data, occurredAt: new Date(parsed.data.occurredAt) };
  },
};

/** Действия «со стороны банка», которых нет у настоящего рельса: их вызывает экран банк-симулятора. */
export const escrowSimulator = {
  account: readAccount,

  /** Заказчик пополняет счёт: банк зачисляет деньги и готовит подписанный вебхук DEPOSIT_RECEIVED. */
  async deposit(externalId: string, amount: number): Promise<SignedDelivery> {
    return mutateAccount(externalId, (acc) => {
      const now = new Date().toISOString();
      const entry = { externalRef: opRef(), kind: "DEPOSIT" as const, amount, occurredAt: now };
      const event = {
        eventId: `evt_${randomBytes(8).toString("hex")}`,
        type: "DEPOSIT_RECEIVED" as const,
        externalId,
        amount,
        operationRef: entry.externalRef,
        occurredAt: now,
      };
      return { account: { ...acc, entries: [...acc.entries, entry], events: [...acc.events, event] }, result: sign(event) };
    });
  },

  /** Повторная доставка последнего события — с новой подписью, но тем же eventId. */
  async redeliverLast(externalId: string): Promise<SignedDelivery | null> {
    const acc = await readAccount(externalId);
    const last = acc.events.at(-1);
    return last ? sign(last) : null;
  },
};
