import { describe, expect, it } from "vitest";
import { ERROR_UNSIGNED, PAYOUT_NOTIFY_XML, RESULT_FAILED, RESULT_OK, signedXml, STATUS_NOT_FOUND } from "./fixtures.test-data";
import { createFreedomPayProvider, type FreedomPayConfig } from "./index";
import { signFields, verifyFields, type FieldValue, type Fields } from "./signature";

// Ключи только для тестов: настоящие ключи нигде в коде не появляются.
const PAY_KEY = "test_payment_key";
const PAYOUT_KEY = "test_payout_key";

const config: FreedomPayConfig = {
  appEnv: "staging",
  apiUrl: "https://api.freedompay.kz",
  merchantId: "12345",
  secretKey: PAY_KEY,
  payoutSecretKey: PAYOUT_KEY,
  resultUrl: "https://staging.senim.kz/api/webhooks/freedompay/result",
  payoutNotifyUrl: "https://staging.senim.kz/api/webhooks/freedompay/payout",
  payoutBackUrl: "https://staging.senim.kz/deals",
};

type Sent = { path: string; params: URLSearchParams };
type Reply = string | Error | ((params: URLSearchParams) => string);

/** Подставной Freedom Pay: ответы по пути метода, по очереди. */
function fakeApi(routes: Record<string, Reply[]>) {
  const sent: Sent[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const params = new URLSearchParams(String(init?.body));
    sent.push({ path, params });
    const reply = routes[path]?.shift();
    if (reply === undefined) throw new Error(`нет ответа для ${path}`);
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply === "function" ? reply(params) : reply, { status: 200, headers: { "content-type": "text/xml" } });
  }) as typeof fetch;
  return { sent, fetchFn };
}

function provider(routes: Record<string, Reply[]>, overrides: Partial<FreedomPayConfig> = {}) {
  const api = fakeApi(routes);
  const p = createFreedomPayProvider(
    { ...config, ...overrides },
    { fetch: api.fetchFn, salt: () => "a1b2c3d4", sleep: async () => {}, now: () => new Date("2026-11-03T06:00:00Z") },
  );
  return { p, sent: api.sent };
}

const status = (fields: Fields) => signedXml("get_status3.php", PAY_KEY, [["pg_status", "ok"], ...fields]);
const holdStatus = (captured: "0" | "1", extra: Fields = []) =>
  status([["pg_payment_id", "777"], ["pg_amount", "15300"], ["pg_payment_status", "success"], ["pg_captured", captured], ...extra]);

describe("фабрика", () => {
  it.each(["dev", "prod"] as const)("APP_ENV=%s — отказ: только staging (ADR-009)", (appEnv) => {
    expect(() => createFreedomPayProvider({ ...config, appEnv })).toThrow(/staging/);
  });

  it("staging — тестовый провайдер freedompay", () => {
    const p = createFreedomPayProvider(config);
    expect(p.name).toBe("freedompay");
    expect(p.isTest).toBe(true);
  });

  it.each([
    ["resultUrl с query (участвует в подписи, а WebhookInput без URL)", { resultUrl: "https://s.kz/r?x=1" }],
    ["resultUrl на «/» (пустое имя скрипта)", { resultUrl: "https://s.kz/r/" }],
    ["apiUrl без https", { apiUrl: "http://api.freedompay.kz" }],
    ["пустой ключ", { secretKey: "" }],
  ])("неверная конфигурация: %s — ошибка без значения ключа", (_, bad) => {
    let message = "";
    try {
      createFreedomPayProvider({ ...config, ...bad });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Freedom Pay/);
    expect(message).not.toContain(PAY_KEY);
  });
});

describe("hold → init_payment", () => {
  const request = { dealId: "d1", idempotencyKey: "hold:d1", amountTiyn: 1_530_000n, description: "Сделка №17", returnUrl: "https://staging.senim.kz/deals/d1" };
  const ok = signedXml("init_payment.php", PAY_KEY, [
    ["pg_status", "ok"],
    ["pg_payment_id", "1022123804618"],
    ["pg_redirect_url", "https://customer.freedompay.kz/pay.html?customer=abc"],
    ["pg_redirect_url_type", "need data"],
  ]);

  it("подписанный запрос с полями документации; итог — PENDING со ссылкой на страницу оплаты", async () => {
    const { p, sent } = provider({ "/init_payment.php": [ok] });
    const result = await p.hold(request);
    expect(result).toEqual({ status: "PENDING", externalRef: "payment:1022123804618", redirectUrl: "https://customer.freedompay.kz/pay.html?customer=abc" });
    const params = sent[0]!.params;
    expect(Object.fromEntries(params)).toMatchObject({
      pg_merchant_id: "12345",
      pg_order_id: "hold:d1",
      pg_idempotency_key: "hold:d1",
      pg_amount: "15300",
      pg_currency: "KZT",
      pg_description: "Сделка №17",
      pg_result_url: config.resultUrl,
      pg_request_method: "POST",
      pg_success_url: request.returnUrl,
      pg_failure_url: request.returnUrl,
      pg_auto_clearing: "0",
      pg_testing_mode: "1",
    });
    expect(verifyFields("init_payment.php", [...params.entries()], PAY_KEY)).toBe(true);
    expect(params.has("pg_card_number")).toBe(false);
  });

  it("одностадийная схема по настройке — pg_auto_clearing=1", async () => {
    const { p, sent } = provider({ "/init_payment.php": [ok] }, { clearing: "one-stage" });
    await p.hold(request);
    expect(sent[0]!.params.get("pg_auto_clearing")).toBe("1");
  });

  it("тиыны без потери точности: 1 234 567,89 ₸ → «1234567.89»", async () => {
    const { p, sent } = provider({ "/init_payment.php": [ok] });
    await p.hold({ ...request, amountTiyn: 123_456_789n });
    expect(sent[0]!.params.get("pg_amount")).toBe("1234567.89");
  });

  it("отказ Freedom Pay — FAILED с кодом и текстом", async () => {
    const { p } = provider({ "/init_payment.php": [ERROR_UNSIGNED] });
    expect(await p.hold(request)).toEqual({ status: "FAILED", error: expect.stringContaining("1100") });
  });

  it("исход неизвестен (сеть) — PENDING без ссылки: статус уточняется по pg_order_id", async () => {
    const { p, sent } = provider({ "/init_payment.php": [new Error("ECONNRESET")] });
    expect(await p.hold(request)).toEqual({ status: "PENDING" });
    expect(sent).toHaveLength(1);
  });

  it("ключ длиннее 50 символов (лимит pg_order_id) — FAILED без запроса", async () => {
    const { p, sent } = provider({});
    const result = await p.hold({ ...request, idempotencyKey: `hold:${"x".repeat(50)}` });
    expect(result.status).toBe("FAILED");
    expect(sent).toHaveLength(0);
  });
});

describe("getStatus", () => {
  it("payment:<id> → get_status3.php по pg_payment_id; success → SUCCEEDED", async () => {
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("0")] });
    expect(await p.getStatus({ idempotencyKey: "hold:d1", externalRef: "payment:777" })).toEqual({ status: "SUCCEEDED", externalRef: "payment:777" });
    expect(sent[0]!.params.get("pg_payment_id")).toBe("777");
    expect(sent[0]!.params.has("pg_order_id")).toBe(false);
  });

  it.each(["new", "waiting", "process"])("pg_payment_status=%s → PENDING", async (s) => {
    const { p } = provider({ "/get_status3.php": [status([["pg_payment_id", "777"], ["pg_payment_status", s]])] });
    expect(await p.getStatus({ idempotencyKey: "hold:d1", externalRef: "payment:777" })).toEqual({ status: "PENDING", externalRef: "payment:777" });
  });

  it("pg_payment_status=error → FAILED с причиной", async () => {
    const xml = status([["pg_payment_id", "777"], ["pg_payment_status", "error"], ["pg_failure_code", "99999"], ["pg_failure_description", "Отказ банка"]]);
    const { p } = provider({ "/get_status3.php": [xml] });
    expect(await p.getStatus({ idempotencyKey: "hold:d1", externalRef: "payment:777" })).toEqual({ status: "FAILED", error: expect.stringContaining("Отказ банка") });
  });

  it("без externalRef (ответ init_payment потерян) — поиск по pg_order_id", async () => {
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("0")] });
    expect(await p.getStatus({ idempotencyKey: "hold:d1", externalRef: null })).toEqual({ status: "SUCCEEDED", externalRef: "payment:777" });
    expect(sent[0]!.params.get("pg_order_id")).toBe("hold:d1");
  });

  it("без externalRef: платежа нет (11068) — ищем выплату по pg_order_id выплатным ключом", async () => {
    const payout = signedXml("payment_status2", PAYOUT_KEY, [["pg_status", "ok"], ["pg_payment_id", "4102"], ["pg_payment_status", "process"]]);
    const { p, sent } = provider({ "/get_status3.php": [STATUS_NOT_FOUND], "/api/payment_status2": [payout] });
    expect(await p.getStatus({ idempotencyKey: "split-master:d1", externalRef: null })).toEqual({ status: "PENDING", externalRef: "payout:4102" });
    expect(verifyFields("payment_status2", [...sent[1]!.params.entries()], PAYOUT_KEY)).toBe(true);
  });

  it("без externalRef и нигде не найдено — FAILED", async () => {
    const notFoundPayout = "<response><pg_status>error</pg_status><pg_error_code>1</pg_error_code><pg_error_description>нет</pg_error_description></response>";
    const { p } = provider({ "/get_status3.php": [STATUS_NOT_FOUND], "/api/payment_status2": [notFoundPayout] });
    expect((await p.getStatus({ idempotencyKey: "x", externalRef: null })).status).toBe("FAILED");
  });

  it("payout:<id> → payment_status2: success → SUCCEEDED, error → FAILED", async () => {
    const ok = signedXml("payment_status2", PAYOUT_KEY, [["pg_status", "ok"], ["pg_payment_id", "4102"], ["pg_payment_status", "success"]]);
    const err = signedXml("payment_status2", PAYOUT_KEY, [["pg_status", "ok"], ["pg_payment_id", "4102"], ["pg_payment_status", "error"], ["pg_failure_code", "10000"]]);
    const { p } = provider({ "/api/payment_status2": [ok, err] });
    expect(await p.getStatus({ idempotencyKey: "k", externalRef: "payout:4102" })).toEqual({ status: "SUCCEEDED", externalRef: "payout:4102" });
    expect((await p.getStatus({ idempotencyKey: "k", externalRef: "payout:4102" })).status).toBe("FAILED");
  });

  it("сеть недоступна после повторов — PENDING (не закрываем операцию)", async () => {
    const { p, sent } = provider({ "/get_status3.php": [new Error("a"), new Error("b"), new Error("c")] });
    expect(await p.getStatus({ idempotencyKey: "hold:d1", externalRef: "payment:777" })).toEqual({ status: "PENDING", externalRef: "payment:777" });
    expect(sent).toHaveLength(3);
  });

  it("refund:<платёж>:<возврат> — статус возврата из pg_refund_payments", async () => {
    const xml = status([
      ["pg_payment_id", "777"],
      ["pg_payment_status", "success"],
      ["pg_refund_payments", [["pg_refund_payment", [["pg_payment_id", "900"], ["pg_payment_status", "success"]]]]],
    ]);
    const { p } = provider({ "/get_status3.php": [xml] });
    expect(await p.getStatus({ idempotencyKey: "refund:d1", externalRef: "refund:777:900" })).toEqual({ status: "SUCCEEDED", externalRef: "refund:777:900" });
  });

  it("cancel:<платёж>:<отмена> — статус из pg_revoked_payments; в списке ещё нет — PENDING", async () => {
    const listed = status([
      ["pg_payment_id", "777"],
      ["pg_payment_status", "success"],
      ["pg_revoked_payments", [["pg_revoked_payment", [["pg_payment_id", "778"], ["pg_payment_status", "process"]]]]],
      ["pg_refund_payments", [["pg_refund_payment", [["pg_payment_id", "778"], ["pg_payment_status", "error"]]]]],
    ]);
    const empty = status([["pg_payment_id", "777"], ["pg_payment_status", "success"]]);
    const { p } = provider({ "/get_status3.php": [listed, empty] });
    expect(await p.getStatus({ idempotencyKey: "refund:d1", externalRef: "cancel:777:778" })).toEqual({ status: "PENDING", externalRef: "cancel:777:778" });
    expect(await p.getStatus({ idempotencyKey: "refund:d1", externalRef: "cancel:777:778" })).toEqual({ status: "PENDING", externalRef: "cancel:777:778" });
  });

  it("refund: элемент с другим id не подходит; ошибка возврата — FAILED", async () => {
    const xml = status([
      ["pg_payment_id", "777"],
      [
        "pg_refund_payments",
        [
          ["pg_refund_payment", [["pg_payment_id", "899"], ["pg_payment_status", "success"]]],
          ["pg_refund_payment", [["pg_payment_id", "900"], ["pg_payment_status", "error"], ["pg_failure_code", "5"]]],
        ],
      ],
    ]);
    const { p } = provider({ "/get_status3.php": [xml] });
    expect((await p.getStatus({ idempotencyKey: "refund:d1", externalRef: "refund:777:900" })).status).toBe("FAILED");
  });

  it("retained:/released: — SUCCEEDED без запроса", async () => {
    const { p, sent } = provider({});
    expect(await p.getStatus({ idempotencyKey: "k", externalRef: "retained:split-platform:d1" })).toEqual({ status: "SUCCEEDED", externalRef: "retained:split-platform:d1" });
    expect(await p.getStatus({ idempotencyKey: "k", externalRef: "released:777" })).toEqual({ status: "SUCCEEDED", externalRef: "released:777" });
    expect(sent).toHaveLength(0);
  });

  it("capture:<id> — SUCCEEDED, если pg_captured=1, иначе FAILED", async () => {
    const { p } = provider({ "/get_status3.php": [holdStatus("1"), holdStatus("0")] });
    expect(await p.getStatus({ idempotencyKey: "release:d1", externalRef: "capture:777" })).toEqual({ status: "SUCCEEDED", externalRef: "capture:777" });
    expect((await p.getStatus({ idempotencyKey: "release:d1", externalRef: "capture:777" })).status).toBe("FAILED");
  });

  it.each(["xpayment:1", "payment:1x", "payment:", "payout:1:2", "refund:1", "cancel:1:2x", "retained:"])("ссылка «%s» не разбирается — FAILED", async (ref) => {
    const { p, sent } = provider({});
    expect((await p.getStatus({ idempotencyKey: "k", externalRef: ref })).status).toBe("FAILED");
    expect(sent).toHaveLength(0);
  });

  it("статус вне документации (new, waiting, process, success, error) — PENDING, а не отказ: итог уточнит следующий опрос", async () => {
    const odd = status([["pg_payment_id", "777"], ["pg_payment_status", "partial_refunded"]]);
    expect(await provider({ "/get_status3.php": [odd] }).p.getStatus({ idempotencyKey: "hold:d1", externalRef: "payment:777" })).toEqual({ status: "PENDING", externalRef: "payment:777" });
  });

  it("незнакомая ссылка — FAILED без запроса", async () => {
    const { p, sent } = provider({});
    expect((await p.getStatus({ idempotencyKey: "k", externalRef: "что-то" })).status).toBe("FAILED");
    expect(sent).toHaveLength(0);
  });
});

const REFUND = { dealId: "d1", idempotencyKey: "refund:d1", amountTiyn: 1_530_000n, reason: "отмена" };

describe("release → клиринг двухстадийной оплаты", () => {
  const request = { dealId: "d1", idempotencyKey: "release:d1", amountTiyn: 1_530_000n, hold: { idempotencyKey: "hold:d1", externalRef: null } };

  it("не списано — do_capture.php на сумму; pg_clearing_amount > 0 → SUCCEEDED", async () => {
    const capture = signedXml("do_capture.php", PAY_KEY, [["pg_status", "ok"], ["pg_amount", "15300"], ["pg_clearing_amount", "15300"]]);
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("0")], "/do_capture.php": [capture] });
    expect(await p.release(request)).toEqual({ status: "SUCCEEDED", externalRef: "capture:777" });
    expect(sent[0]!.params.get("pg_order_id")).toBe("hold:d1");
    expect(Object.fromEntries(sent[1]!.params)).toMatchObject({ pg_payment_id: "777", pg_clearing_amount: "15300" });
  });

  it("уже списано (одностадийная или повтор) — SUCCEEDED без второго клиринга", async () => {
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("1")] });
    expect(await p.release(request)).toEqual({ status: "SUCCEEDED", externalRef: "capture:777" });
    expect(sent.map((s) => s.path)).toEqual(["/get_status3.php"]);
  });

  it("pg_clearing_amount = 0 — FAILED («nothing was captured»)", async () => {
    const capture = signedXml("do_capture.php", PAY_KEY, [["pg_status", "ok"], ["pg_amount", "15300"], ["pg_clearing_amount", "0"]]);
    const { p } = provider({ "/get_status3.php": [holdStatus("0")], "/do_capture.php": [capture] });
    expect((await p.release(request)).status).toBe("FAILED");
  });

  it("платёж ищется по подтверждённой оплате журнала: по номеру платежа, без номера — по ключу прошедшей попытки", async () => {
    const byRef = provider({ "/get_status3.php": [holdStatus("1")] });
    await byRef.p.release({ ...request, hold: { idempotencyKey: "hold:d1:2", externalRef: "payment:777" } });
    expect(Object.fromEntries(byRef.sent[0]!.params)).toMatchObject({ pg_payment_id: "777" });
    expect(byRef.sent[0]!.params.get("pg_order_id")).toBeNull();

    const byKey = provider({ "/get_status3.php": [holdStatus("1")] });
    await byKey.p.refund({ ...REFUND, hold: { idempotencyKey: "hold:d1:2", externalRef: null } });
    expect(byKey.sent[0]!.params.get("pg_order_id")).toBe("hold:d1:2");
  });

  it("оплата не найдена — FAILED; оплата ещё не прошла — PENDING", async () => {
    expect((await provider({ "/get_status3.php": [STATUS_NOT_FOUND] }).p.release(request)).status).toBe("FAILED");
    const waiting = status([["pg_payment_id", "777"], ["pg_payment_status", "waiting"], ["pg_captured", "0"]]);
    expect((await provider({ "/get_status3.php": [waiting] }).p.release(request)).status).toBe("PENDING");
  });
});

describe("split → выплата мастеру reg2nonreg; доход платформы остаётся у мерчанта", () => {
  const request = {
    dealId: "d1",
    master: { dealId: "d1", idempotencyKey: "split-master:d1", amountTiyn: 1_440_000n, recipient: { iban: "KZ000000000000000000", name: "Мастер" } },
    platform: { dealId: "d1", idempotencyKey: "split-platform:d1", amountTiyn: 90_000n },
  };
  const ok = signedXml("reg2nonreg", PAYOUT_KEY, [
    ["pg_status", "ok"],
    ["pg_merchant_id", "12345"],
    ["pg_payment_id", "4102"],
    ["pg_redirect_url", "https://customer.freedompay.kz/payout.html?customer=01a1"],
  ]);

  it("мастер — PENDING со ссылкой на страницу выплаты; запрос подписан выплатным ключом", async () => {
    const { p, sent } = provider({ "/api/reg2nonreg": [ok] });
    const result = await p.split(request);
    expect(result.master).toEqual({ status: "PENDING", externalRef: "payout:4102", redirectUrl: "https://customer.freedompay.kz/payout.html?customer=01a1" });
    expect(result.platform).toEqual({ status: "SUCCEEDED", externalRef: "retained:split-platform:d1" });
    const params = sent[0]!.params;
    expect(Object.fromEntries(params)).toMatchObject({
      pg_order_id: "split-master:d1",
      pg_idempotency_key: "split-master:d1",
      pg_amount: "14400",
      pg_post_link: config.payoutNotifyUrl,
      pg_back_link: config.payoutBackUrl,
      // 06:00 UTC + 72 ч в Asia/Almaty (UTC+5)
      pg_order_time_limit: "2026-11-06 11:00:00",
    });
    expect(verifyFields("reg2nonreg", [...params.entries()], PAYOUT_KEY)).toBe(true);
    // IBAN и имя мастера на страницу выплаты не уходят
    expect([...params.values()].join(" ")).not.toMatch(/KZ0000|Мастер/);
  });

  it("без выплатного ключа — мастер FAILED, запроса нет", async () => {
    const { p, sent } = provider({}, { payoutSecretKey: undefined });
    expect((await p.split(request)).master.status).toBe("FAILED");
    expect(sent).toHaveLength(0);
  });

  it("отказ reg2nonreg — FAILED с кодом", async () => {
    const declined = "<response><pg_status>error</pg_status><pg_error_code>10000</pg_error_code><pg_error_description>Выплаты на карты не подключены</pg_error_description></response>";
    const { p } = provider({ "/api/reg2nonreg": [declined] });
    expect((await p.split(request)).master).toEqual({ status: "FAILED", error: expect.stringContaining("10000") });
  });
});

describe("refund", () => {
  const request = { dealId: "d1", idempotencyKey: "refund:d1", amountTiyn: 1_530_000n, reason: "спор", hold: { idempotencyKey: "hold:d1", externalRef: null } };

  it("двухстадийная, не списана, полная сумма — cancel (разблокировка)", async () => {
    const cancel = signedXml("cancel", PAY_KEY, [["pg_status", "ok"], ["pg_cancel_payment_id", "778"]]);
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("0")], "/cancel": [cancel] });
    expect(await p.refund(request)).toEqual({ status: "SUCCEEDED", externalRef: "cancel:777:778" });
    expect(Object.fromEntries(sent[1]!.params)).toMatchObject({ pg_payment_id: "777", pg_idempotency_key: "refund:d1" });
  });

  it("списана — revoke на сумму возврата", async () => {
    const revoke = signedXml("revoke", PAY_KEY, [["pg_status", "ok"], ["pg_revoke_payment_id", "900"]]);
    const captured = holdStatus("1", [["pg_clearing_amount", "15300"]]);
    const { p, sent } = provider({ "/get_status3.php": [captured], "/revoke": [revoke] });
    expect(await p.refund({ ...request, amountTiyn: 500_000n })).toEqual({ status: "SUCCEEDED", externalRef: "refund:777:900" });
    expect(Object.fromEntries(sent[1]!.params)).toMatchObject({ pg_payment_id: "777", pg_refund_amount: "5000", pg_idempotency_key: "refund:d1" });
  });

  it("не списана, частичный возврат — FAILED: revoke сперва списал бы всю сумму", async () => {
    const { p, sent } = provider({ "/get_status3.php": [holdStatus("0")] });
    expect((await p.refund({ ...request, amountTiyn: 500_000n })).status).toBe("FAILED");
    expect(sent).toHaveLength(1);
  });

  it("после частичного клиринга остаток уже разблокирован — SUCCEEDED без второго возврата", async () => {
    const partial = holdStatus("1", [["pg_clearing_amount", "10300"]]);
    const { p, sent } = provider({ "/get_status3.php": [partial] });
    expect(await p.refund({ ...request, amountTiyn: 500_000n })).toEqual({ status: "SUCCEEDED", externalRef: "released:777" });
    expect(sent).toHaveLength(1);
  });

  it("возврат уже идёт (91021) — PENDING; прочий отказ — FAILED", async () => {
    const inProgress = "<response><pg_status>error</pg_status><pg_error_code>91021</pg_error_code><pg_error_description>Возврат уже обрабатывается</pg_error_description></response>";
    const captured = holdStatus("1", [["pg_clearing_amount", "15300"]]);
    expect((await provider({ "/get_status3.php": [captured], "/revoke": [inProgress] }).p.refund(request)).status).toBe("PENDING");
    const declined = signedXml("revoke", PAY_KEY, [["pg_status", "error"], ["pg_revoke_payment_id", "901"], ["pg_failure_code", "99999"], ["pg_failure_description", "Отказ"]]);
    const captured2 = holdStatus("1", [["pg_clearing_amount", "15300"]]);
    expect((await provider({ "/get_status3.php": [captured2], "/revoke": [declined] }).p.refund(request)).status).toBe("FAILED");
  });
});

describe("handleWebhook", () => {
  const form = (fields: Fields) => new URLSearchParams(fields.map(([k, v]) => [k, String(v)])).toString();
  const signedResult = (fields: Fields, key = PAY_KEY, script = "result") => form([...fields, ["pg_sig", signFields(script, fields, key)]]);
  const input = (body: string) => ({ headers: new Headers({ "content-type": "application/x-www-form-urlencoded" }), body });
  const testOk: Fields = [...RESULT_OK.map(([k, v]): [string, string] => [k, k === "pg_order_id" ? "hold:d1" : v]), ["pg_testing_mode", "1"]];
  const OK_XML = '<?xml version="1.0" encoding="utf-8"?>\n<response>\n    <pg_status>ok</pg_status>\n</response>';

  it("Result notify, pg_result=1 — settled SUCCEEDED; ответ — XML pg_status=ok", async () => {
    const result = await provider({}).p.handleWebhook(input(signedResult(testOk)));
    expect(result).toEqual({
      kind: "settled",
      externalEventId: "freedompay:result:1022123804618:1",
      idempotencyKey: "hold:d1",
      result: { status: "SUCCEEDED", externalRef: "payment:1022123804618" },
      amountTiyn: 100_000n,
      currency: "KZT",
      response: { status: 200, contentType: "text/xml; charset=utf-8", body: OK_XML },
    });
  });

  it("сумма уведомления не разбирается — rejected: сверить с журналом нечем", async () => {
    const bad: Fields = testOk.map(([k, v]): [string, string] => [k, k === "pg_amount" ? "сто" : String(v)]);
    expect((await provider({}).p.handleWebhook(input(signedResult(bad)))).kind).toBe("rejected");
  });

  it("повтор того же уведомления — тот же externalEventId", async () => {
    const { p } = provider({});
    const body = signedResult(testOk);
    const a = await p.handleWebhook(input(body));
    const b = await p.handleWebhook(input(body));
    expect(a.kind === "settled" && b.kind === "settled" && a.externalEventId === b.externalEventId).toBe(true);
  });

  it("Result notify, pg_result=0 — settled FAILED с причиной из pg_failure_description", async () => {
    const failed: Fields = [...RESULT_FAILED, ["pg_testing_mode", "1"]];
    const result = await provider({}).p.handleWebhook(input(signedResult(failed)));
    expect(result).toMatchObject({
      kind: "settled",
      idempotencyKey: "order-1002",
      result: { status: "FAILED", error: expect.stringContaining("Неизвестная ошибка платежной системы") },
    });
  });

  it.each([
    ["неверная подпись", () => signedResult(testOk, "чужой_ключ")],
    ["подпись другим скриптом", () => signedResult(testOk, PAY_KEY, "payout")],
    ["нет подписи", () => form(testOk)],
    ["подмена суммы после подписи", () => signedResult(testOk).replace("pg_amount=1000", "pg_amount=1")],
    ["пустое тело", () => ""],
  ])("%s — rejected", async (_, body) => {
    expect((await provider({}).p.handleWebhook(input(body()))).kind).toBe("rejected");
  });

  it("неизвестное новое поле не ломает проверку («do not reject a callback because of a field that you do not know»)", async () => {
    const result = await provider({}).p.handleWebhook(input(signedResult([...testOk, ["pg_new_field", "x"]])));
    expect(result.kind).toBe("settled");
  });

  it("не тестовый платёж (нет pg_testing_mode=1) на стенде — ignored, ответ ok (не rejected: тот вернул бы деньги)", async () => {
    const live = RESULT_OK.map(([k, v]): [string, string] => [k, v]);
    const result = await provider({}).p.handleWebhook(input(signedResult(live)));
    expect(result).toMatchObject({ kind: "ignored", externalEventId: "freedompay:result:1022123804618:1", response: { status: 200, body: OK_XML } });
  });

  it("Payout notify (pg_xml, корень response, выплатный ключ, скрипт = последний сегмент pg_post_link) — settled", async () => {
    const fields: Fields = [
      ["pg_status", "ok"],
      ["pg_payment_status", "success"],
      ["pg_payment_id", "4102"],
      ["pg_order_id", "split-master:d1"],
      ["pg_payment_amount", "14400"],
      ["pg_payment_date", "2026-11-06 10:00:00"],
    ];
    const xml = signedXml("payout", PAYOUT_KEY, fields);
    const result = await provider({}).p.handleWebhook(input(form([["pg_xml", xml]])));
    expect(result).toEqual({
      kind: "settled",
      externalEventId: "freedompay:payout:4102:success",
      idempotencyKey: "split-master:d1",
      result: { status: "SUCCEEDED", externalRef: "payout:4102" },
      amountTiyn: 1_440_000n,
      response: { status: 200, contentType: "text/xml; charset=utf-8", body: '<?xml version="1.0" encoding="utf-8"?>\n<pg_status>ok</pg_status>' },
    });
  });

  it("Payout notify, подписанный платёжным ключом или пример документации с чужой подписью — rejected", async () => {
    const fields: Fields = [["pg_status", "ok"], ["pg_payment_status", "success"], ["pg_payment_id", "4102"], ["pg_order_id", "x"]];
    const { p } = provider({});
    expect((await p.handleWebhook(input(form([["pg_xml", signedXml("payout", PAY_KEY, fields)]])))).kind).toBe("rejected");
    expect((await p.handleWebhook(input(form([["pg_xml", PAYOUT_NOTIFY_XML]])))).kind).toBe("rejected");
  });

  it("Result notify в режиме XML (pg_xml, корень request) — проверяется платёжным ключом", async () => {
    const xml = signedXml("result", PAY_KEY, testOk.filter(([k]) => k !== "pg_salt"), "request");
    expect((await provider({}).p.handleWebhook(input(form([["pg_xml", xml]])))).kind).toBe("settled");
  });

  it.each([
    ["неизвестный корень pg_xml", () => form([["pg_xml", signedXml("result", PAY_KEY, [["pg_order_id", "x"]], "other")]])],
    ["битый pg_xml", () => form([["pg_xml", "<response>"]])],
    ["нет pg_order_id", () => signedResult(testOk.filter(([k]) => k !== "pg_order_id"))],
    ["pg_payment_id не число", () => signedResult(testOk.map(([k, v]): [string, FieldValue] => [k, k === "pg_payment_id" ? "12a" : v]))],
    ["нет pg_result", () => signedResult(testOk.filter(([k]) => k !== "pg_result"))],
  ])("%s — rejected", async (_, body) => {
    expect((await provider({}).p.handleWebhook(input(body()))).kind).toBe("rejected");
  });

  it("pg_result=2 (не завершён) — ignored с ответом ok", async () => {
    const pending = testOk.map(([k, v]): [string, FieldValue] => [k, k === "pg_result" ? "2" : v]);
    expect(await provider({}).p.handleWebhook(input(signedResult(pending)))).toMatchObject({ kind: "ignored", externalEventId: "freedompay:result:1022123804618:2" });
  });

  it("Payout notify в статусе process — ignored; без выплатного ключа — rejected", async () => {
    const fields: Fields = [["pg_status", "ok"], ["pg_payment_status", "process"], ["pg_payment_id", "4104"], ["pg_order_id", "split-master:d3"]];
    const body = form([["pg_xml", signedXml("payout", PAYOUT_KEY, fields)]]);
    expect(await provider({}).p.handleWebhook(input(body))).toMatchObject({ kind: "ignored", externalEventId: "freedompay:payout:4104:process" });
    expect((await provider({}, { payoutSecretKey: undefined }).p.handleWebhook(input(body))).kind).toBe("rejected");
  });

  it("Payout notify с ошибкой — settled FAILED", async () => {
    const fields: Fields = [["pg_status", "error"], ["pg_payment_status", "error"], ["pg_payment_id", "4103"], ["pg_order_id", "split-master:d2"], ["pg_failure_code", "10001"], ["pg_failure_description", "Отказ"]];
    const result = await provider({}).p.handleWebhook(input(form([["pg_xml", signedXml("payout", PAYOUT_KEY, fields)]])));
    expect(result).toMatchObject({ kind: "settled", externalEventId: "freedompay:payout:4103:error", result: { status: "FAILED" } });
  });
});
