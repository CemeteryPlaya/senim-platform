import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { HoldRequest, PaymentProvider, ProviderResult, RefundRequest, ReleaseRequest, SplitRequest, StatusRequest } from "../../provider";
import { amountToTiyn, createFreedomPayClient, defaultSalt, defaultSleep, tiynToAmount, type ApiOutcome, type ClientDeps } from "./client";
import type { Fields } from "./signature";
import { formatRef, notOk, operationResult, parseRef, statusResult, type Ref } from "./status";
import { handleFreedomPayWebhook } from "./webhook";
import { fieldText } from "./xml";

/** Причины отказа операции (MoneyTransaction.error) — их видит оператор. */
const t = ru.payments.freedompay;

/**
 * Провайдер Freedom Pay для песочницы (ADR-009, раздел 5): только `APP_ENV=staging`, только тестовые платежи
 * (`pg_testing_mode=1`). Всё — по публичной документации https://docs.freedompay.kz (ссылки у методов);
 * чего там нет — честный FAILED/PENDING и TODO(freedompay). Разбор схемы и ограничений —
 * docs/bank/07-freedompay-integration.md.
 *
 * Схема денег:
 * - hold → `init_payment.php`: покупатель платит на странице Freedom Pay (карта не проходит через наш сервер).
 *   По умолчанию двухстадийно (`pg_auto_clearing=0`): сумма блокируется на карте покупателя.
 * - release → `do_capture.php`: списание заблокированной суммы (клиринг). После него деньги — у мерчанта.
 * - split → мастеру `reg2nonreg` (страница выплаты, карту вводит мастер); доход платформы перевода не требует:
 *   он уже в списанной сумме на балансе мерчанта. Если мерчант — ТОО, это ровно то, что запрещено
 *   инвариантом «деньги клиентов не проходят через счета ТОО»: поэтому только staging.
 * - refund → `cancel` (разблокировка несписанной) или `revoke` (возврат списанной).
 */

const PATH = {
  initPayment: "/init_payment.php",
  status: "/get_status3.php",
  capture: "/do_capture.php",
  cancel: "/cancel",
  refund: "/revoke",
  payout: "/api/reg2nonreg",
  payoutStatus: "/api/payment_status2",
} as const;

/** «payment not found, or it belongs to another merchant» (get_status3.php). */
const PAYMENT_NOT_FOUND = "11068";
/** «refund already in progress» (revoke). */
const REFUND_IN_PROGRESS = "91021";
/** pg_order_id: «string, max 50». */
const ORDER_ID_MAX = 50;

const callbackUrl = z
  .url()
  .refine((u) => !/[?#]/.test(u), "без query и #: параметры URL участвуют в подписи, а уведомление приходит без URL")
  .refine((u) => !u.endsWith("/"), "не на «/»: имя скрипта подписи было бы пустым");

const configSchema = z.object({
  appEnv: z.enum(["dev", "staging", "prod"]),
  apiUrl: z.url().refine((u) => u.startsWith("https://"), "только https"),
  merchantId: z.string().regex(/^\d+$/, "число"),
  secretKey: z.string().min(1),
  payoutSecretKey: z.string().min(1).optional(),
  /** pg_result_url — наш приём Result notify. */
  resultUrl: callbackUrl,
  /** pg_post_link выплат — наш приём Payout notify. */
  payoutNotifyUrl: callbackUrl,
  /** pg_back_link — куда вернуть мастера со страницы выплаты. */
  payoutBackUrl: z.url(),
  /** two-stage — `pg_auto_clearing=0` (блокировка, затем клиринг); one-stage — `1` (списание сразу). */
  clearing: z.enum(["two-stage", "one-stage"]).default("two-stage"),
  /** Ключ операции hold сделки: release и refund находят по нему платёж (`pg_order_id`). */
  holdKeyOf: z.custom<(dealId: string) => string>((v) => typeof v === "function").default(() => (dealId: string) => `hold:${dealId}`),
  /** pg_lifetime страницы оплаты, секунды: «60 to 604800, default 86400». */
  paymentLifetimeSec: z.number().int().min(60).max(604_800).default(86_400),
  /** Срок ссылки на выплату (pg_order_time_limit), часы. */
  payoutLinkHours: z.number().int().min(1).max(24 * 30).default(72),
  /** pg_order_time_limit — «merchant time zone». TODO(freedompay): подтвердить часовой пояс мерчанта. */
  merchantTimeZone: z.string().default("Asia/Almaty"),
  timeoutMs: z.number().int().min(1000).default(15_000),
  statusRetries: z.number().int().min(0).max(5).default(2),
});

export type FreedomPayConfig = z.input<typeof configSchema>;
export type FreedomPayDeps = Partial<ClientDeps> & { now?: () => Date };

/** «YYYY-MM-DD hh:mm:ss» в часовом поясе мерчанта. */
function localTime(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function orderIdProblem(key: string): ProviderResult | null {
  return key.length > ORDER_ID_MAX ? { status: "FAILED", error: `Ключ операции длиннее ${ORDER_ID_MAX} символов — Freedom Pay не примет pg_order_id` } : null;
}

export function createFreedomPayProvider(input: FreedomPayConfig, deps: FreedomPayDeps = {}): PaymentProvider {
  if (input.appEnv !== "staging") {
    throw new Error("Freedom Pay разрешён только при APP_ENV=staging: схема без зачисления денег клиентов на счёт ТОО не подтверждена (ADR-009)");
  }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    // Только имена полей и правила: значения (ключи) в сообщение не попадают.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Неверная конфигурация Freedom Pay — ${issues}`);
  }
  const config = parsed.data;
  const now = deps.now ?? (() => new Date());
  const client = createFreedomPayClient(
    { apiUrl: config.apiUrl, merchantId: config.merchantId, timeoutMs: config.timeoutMs, statusRetries: config.statusRetries },
    { fetch: deps.fetch ?? fetch, salt: deps.salt ?? defaultSalt, sleep: deps.sleep ?? defaultSleep },
  );
  const payKey = config.secretKey;
  const amount = (tiyn: bigint) => tiynToAmount(tiyn);

  /** https://docs.freedompay.kz/11620963e0 — статус платежа по pg_payment_id или pg_order_id. */
  const paymentStatus = (by: ["pg_payment_id" | "pg_order_id", string]) => client.call(PATH.status, [by], payKey, { idempotent: true });

  /** https://docs.freedompay.kz/12100676e0 — статус выплаты, выплатный ключ. */
  async function payoutStatus(by: ["pg_payment_id" | "pg_order_id", string]): Promise<ApiOutcome> {
    if (!config.payoutSecretKey) return { kind: "declined", code: "", description: "выплатный ключ не задан" };
    return client.call(PATH.payoutStatus, [by], config.payoutSecretKey, { idempotent: true });
  }

  function paymentResult(fields: Fields, fallbackId?: string): ProviderResult {
    const paymentId = fieldText(fields, "pg_payment_id") ?? fallbackId ?? "";
    return statusResult(fieldText(fields, "pg_payment_status"), fields, formatRef({ kind: "payment", paymentId }));
  }

  type Hold = { paymentId: string; captured: boolean; amountTiyn: bigint | null; clearingTiyn: bigint | null };

  /** Платёж hold сделки; не найден, не оплачен или исход неизвестен — готовый ProviderResult. */
  async function findHold(dealId: string): Promise<Hold | ProviderResult> {
    const outcome = await paymentStatus(["pg_order_id", config.holdKeyOf(dealId)]);
    const state = outcome.kind === "ok" ? paymentResult(outcome.fields) : notOk(outcome);
    if (state.status === "FAILED") return { status: "FAILED", error: `Оплата сделки не найдена или не прошла: ${state.error}` };
    if (outcome.kind !== "ok" || state.status === "PENDING") return { status: "PENDING" };
    const f = outcome.fields;
    const money = (name: string) => {
      const text = fieldText(f, name);
      return text === undefined ? null : amountToTiyn(text);
    };
    return { paymentId: fieldText(f, "pg_payment_id") ?? "", captured: fieldText(f, "pg_captured") === "1", amountTiyn: money("pg_amount"), clearingTiyn: money("pg_clearing_amount") };
  }
  const isHold = (h: Hold | ProviderResult): h is Hold => "paymentId" in h;

  async function statusByRef(ref: Ref): Promise<ProviderResult> {
    const externalRef = formatRef(ref);
    switch (ref.kind) {
      case "retained":
      case "released":
        return { status: "SUCCEEDED", externalRef };
      case "payout": {
        const outcome = await payoutStatus(["pg_payment_id", ref.payoutId]);
        return outcome.kind === "ok" ? statusResult(fieldText(outcome.fields, "pg_payment_status"), outcome.fields, externalRef) : notOk(outcome, externalRef);
      }
      default: {
        const outcome = await paymentStatus(["pg_payment_id", ref.paymentId]);
        if (outcome.kind !== "ok") return notOk(outcome, externalRef);
        if (ref.kind === "payment") return paymentResult(outcome.fields, ref.paymentId);
        if (ref.kind === "capture") {
          return fieldText(outcome.fields, "pg_captured") === "1" ? { status: "SUCCEEDED", externalRef } : { status: "FAILED", error: t.notCaptured };
        }
        return operationResult(outcome.fields, ref);
      }
    }
  }

  return {
    name: "freedompay",
    isTest: true,

    /** https://docs.freedompay.kz/create-payment-11620859e0 — POST /init_payment.php. */
    async hold(request: HoldRequest): Promise<ProviderResult> {
      const problem = orderIdProblem(request.idempotencyKey);
      if (problem) return problem;
      const outcome = await client.call(
        PATH.initPayment,
        [
          ["pg_order_id", request.idempotencyKey],
          // «a repeat with the same key returns the existing payment»: повтор hold не создаёт второй платёж.
          ["pg_idempotency_key", request.idempotencyKey],
          ["pg_amount", amount(request.amountTiyn)],
          ["pg_currency", "KZT"],
          ["pg_description", request.description],
          ["pg_result_url", config.resultUrl],
          ["pg_request_method", "POST"],
          ["pg_success_url", request.returnUrl],
          ["pg_failure_url", request.returnUrl],
          ["pg_auto_clearing", config.clearing === "two-stage" ? "0" : "1"],
          ["pg_lifetime", String(config.paymentLifetimeSec)],
          ["pg_language", "ru"],
          ["pg_testing_mode", "1"],
        ],
        payKey,
      );
      if (outcome.kind !== "ok") return notOk(outcome);
      const paymentId = fieldText(outcome.fields, "pg_payment_id");
      const redirectUrl = fieldText(outcome.fields, "pg_redirect_url");
      if (!paymentId || !redirectUrl?.startsWith("https://")) return { status: "PENDING" };
      return { status: "PENDING", externalRef: formatRef({ kind: "payment", paymentId }), redirectUrl };
    },

    /** https://docs.freedompay.kz/11621002e0 — POST /do_capture.php; повтор не списывает второй раз. */
    async release(request: ReleaseRequest): Promise<ProviderResult> {
      const hold = await findHold(request.dealId);
      if (!isHold(hold)) return hold;
      const externalRef = formatRef({ kind: "capture", paymentId: hold.paymentId });
      if (hold.captured) return { status: "SUCCEEDED", externalRef };
      const outcome = await client.call(PATH.capture, [["pg_payment_id", hold.paymentId], ["pg_clearing_amount", amount(request.amountTiyn)]], payKey);
      if (outcome.kind !== "ok") return notOk(outcome, externalRef);
      const cleared = amountToTiyn(fieldText(outcome.fields, "pg_clearing_amount") ?? "");
      // «A pg_clearing_amount of 0 means nothing was captured».
      return cleared !== null && cleared > 0n ? { status: "SUCCEEDED", externalRef } : { status: "FAILED", error: t.nothingCleared };
    },

    async split(request: SplitRequest) {
      return {
        master: await payoutToMaster(request.master),
        // Доход платформы — часть уже списанной суммы на балансе мерчанта: отдельного перевода нет (см. шапку файла).
        platform: { status: "SUCCEEDED", externalRef: formatRef({ kind: "retained", key: request.platform.idempotencyKey }) } satisfies ProviderResult,
      };
    },

    async refund(request: RefundRequest): Promise<ProviderResult> {
      const hold = await findHold(request.dealId);
      if (!isHold(hold)) return hold;
      if (!hold.captured) return cancelHold(hold, request);
      // Частичный клиринг: «The rest is released to the client» — этот остаток уже вернулся, второй возврат был бы лишним.
      if (hold.amountTiyn !== null && hold.clearingTiyn !== null && hold.amountTiyn - hold.clearingTiyn === request.amountTiyn) {
        return { status: "SUCCEEDED", externalRef: formatRef({ kind: "released", paymentId: hold.paymentId }) };
      }
      return revokeCaptured(hold, request);
    },

    async getStatus(request: StatusRequest): Promise<ProviderResult> {
      if (request.externalRef !== null) {
        const ref = parseRef(request.externalRef);
        return ref ? statusByRef(ref) : { status: "FAILED", error: `Незнакомая ссылка операции Freedom Pay: ${request.externalRef}` };
      }
      // Ответ на создание потерян: «look up the payment by pg_order_id». Ключи операций уникальны — платёж или выплата.
      const payment = await paymentStatus(["pg_order_id", request.idempotencyKey]);
      if (payment.kind === "ok") return paymentResult(payment.fields);
      if (payment.kind === "unknown" || payment.code !== PAYMENT_NOT_FOUND) return notOk(payment);
      const payout = await payoutStatus(["pg_order_id", request.idempotencyKey]);
      if (payout.kind !== "ok") return payout.kind === "unknown" ? { status: "PENDING" } : { status: "FAILED", error: t.operationUnknown };
      const payoutId = fieldText(payout.fields, "pg_payment_id") ?? "";
      return statusResult(fieldText(payout.fields, "pg_payment_status"), payout.fields, formatRef({ kind: "payout", payoutId }));
    },

    handleWebhook: (webhook) =>
      handleFreedomPayWebhook(
        { secretKey: payKey, payoutSecretKey: config.payoutSecretKey, resultUrl: config.resultUrl, payoutNotifyUrl: config.payoutNotifyUrl },
        webhook,
      ),
  };

  /** https://docs.freedompay.kz/11621007e0 — POST /cancel разблокирует всю несписанную сумму; частично — нельзя. */
  async function cancelHold(hold: Hold, request: RefundRequest): Promise<ProviderResult> {
    if (hold.amountTiyn !== request.amountTiyn) {
      return { status: "FAILED", error: t.partialRefundOfUncaptured };
    }
    const outcome = await client.call(PATH.cancel, [["pg_payment_id", hold.paymentId], ["pg_idempotency_key", request.idempotencyKey]], payKey);
    if (outcome.kind !== "ok") return notOk(outcome);
    const operationId = fieldText(outcome.fields, "pg_cancel_payment_id") ?? "";
    return { status: "SUCCEEDED", externalRef: formatRef({ kind: "cancel", paymentId: hold.paymentId, operationId }) };
  }

  /** https://docs.freedompay.kz/11621013e0 — POST /revoke: возврат списанной суммы, частичные — повторами. */
  async function revokeCaptured(hold: Hold, request: RefundRequest): Promise<ProviderResult> {
    const outcome = await client.call(
      PATH.refund,
      [["pg_payment_id", hold.paymentId], ["pg_refund_amount", amount(request.amountTiyn)], ["pg_idempotency_key", request.idempotencyKey]],
      payKey,
    );
    if (outcome.kind === "declined" && outcome.code === REFUND_IN_PROGRESS) return { status: "PENDING" };
    if (outcome.kind !== "ok") return notOk(outcome);
    const operationId = fieldText(outcome.fields, "pg_revoke_payment_id") ?? "";
    return { status: "SUCCEEDED", externalRef: formatRef({ kind: "refund", paymentId: hold.paymentId, operationId }) };
  }

  /**
   * https://docs.freedompay.kz/create-payment-11621022e0 — POST /api/reg2nonreg: страница выплаты, карту вводит мастер.
   * TODO(freedompay): выплата на IBAN (https://docs.freedompay.kz/11621076e0, /api/to_iban) требует
   * pg_recipient_iin, pg_recipient_kbe, pg_knp — их нет в PayoutRecipient; IBAN мастера сюда не передаётся.
   * TODO(freedompay): у reg2nonreg нет pg_testing_mode — подтвердить, что выплаты тестового мерчанта не двигают деньги.
   */
  async function payoutToMaster(master: SplitRequest["master"]): Promise<ProviderResult> {
    if (!config.payoutSecretKey) return { status: "FAILED", error: t.payoutsNotConfigured };
    const problem = orderIdProblem(master.idempotencyKey);
    if (problem) return problem;
    const deadline = new Date(now().getTime() + config.payoutLinkHours * 3_600_000);
    const outcome = await client.call(
      PATH.payout,
      [
        ["pg_order_id", master.idempotencyKey],
        ["pg_idempotency_key", master.idempotencyKey],
        ["pg_amount", amount(master.amountTiyn)],
        ["pg_description", "Выплата по сделке"],
        ["pg_order_time_limit", localTime(deadline, config.merchantTimeZone)],
        ["pg_post_link", config.payoutNotifyUrl],
        ["pg_back_link", config.payoutBackUrl],
      ],
      config.payoutSecretKey,
    );
    if (outcome.kind !== "ok") return notOk(outcome);
    const payoutId = fieldText(outcome.fields, "pg_payment_id");
    const redirectUrl = fieldText(outcome.fields, "pg_redirect_url");
    if (!payoutId || !redirectUrl?.startsWith("https://")) return { status: "PENDING" };
    return { status: "PENDING", externalRef: formatRef({ kind: "payout", payoutId }), redirectUrl };
  }
}
