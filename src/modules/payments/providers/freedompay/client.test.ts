import { describe, expect, it, vi } from "vitest";
import { amountToTiyn, createFreedomPayClient, tiynToAmount } from "./client";
import { ERROR_UNSIGNED, INIT_PAYMENT_OK, PAYOUT_STATUS_OK, resign } from "./fixtures.test-data";
import { signFields, verifyFields, type Fields } from "./signature";

const KEY = "test_payment_key";
const API = "https://api.freedompay.kz";

type Call = { url: string; body: URLSearchParams; contentType: string | null };

function fakeFetch(...responses: Array<string | Error | { status: number; body: string }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)), contentType: new Headers(init?.headers).get("content-type") });
    const next = responses.shift() ?? new Error("нет ответа");
    if (next instanceof Error) throw next;
    const { status, body } = typeof next === "string" ? { status: 200, body: next } : next;
    return new Response(body, { status, headers: { "content-type": "text/xml" } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function client(fetchFn: typeof fetch, statusRetries = 2) {
  return createFreedomPayClient(
    { apiUrl: API, merchantId: "12345", timeoutMs: 5000, statusRetries },
    { fetch: fetchFn, salt: () => "a1b2c3d4", sleep: async () => {} },
  );
}

describe("суммы: тиыны ↔ формат документации («up to 2 decimals with a dot»)", () => {
  it.each([
    [10000n, "100"],
    [10050n, "100.5"],
    [10005n, "100.05"],
    [1n, "0.01"],
    [9_999_999_999n, "99999999.99"],
  ])("%s тиын → %s", (tiyn, text) => {
    expect(tiynToAmount(tiyn)).toBe(text);
    expect(amountToTiyn(text)).toBe(tiyn);
  });

  it("без float: большие суммы точны до тиына", () => {
    expect(tiynToAmount(1_234_567_891n)).toBe("12345678.91");
  });

  it("вне диапазона документации 0.01…99999999 — ошибка", () => {
    expect(() => tiynToAmount(0n)).toThrow();
    expect(() => tiynToAmount(10_000_000_000n)).toThrow();
  });

  it("разбор: «100.50», «-40.00», мусор", () => {
    expect(amountToTiyn("100.50")).toBe(10050n);
    expect(amountToTiyn("-40.00")).toBe(-4000n);
    expect(amountToTiyn("1e3")).toBeNull();
    expect(amountToTiyn("")).toBeNull();
    expect(amountToTiyn("1.234")).toBeNull();
  });
});

describe("HTTP-клиент Freedom Pay", () => {
  it("POST form-urlencoded на путь метода, с pg_merchant_id, pg_salt и верной pg_sig", async () => {
    const { fn, calls } = fakeFetch(resign(INIT_PAYMENT_OK, "init_payment.php", KEY));
    const out = await client(fn).call("/init_payment.php", [["pg_amount", "100"]], KEY);
    expect(out.kind).toBe("ok");
    expect(calls[0]!.url).toBe("https://api.freedompay.kz/init_payment.php");
    expect(calls[0]!.contentType).toBe("application/x-www-form-urlencoded");
    const sent: Fields = [...calls[0]!.body.entries()];
    expect(calls[0]!.body.get("pg_merchant_id")).toBe("12345");
    expect(calls[0]!.body.get("pg_salt")).toBe("a1b2c3d4");
    expect(verifyFields("init_payment.php", sent, KEY)).toBe(true);
  });

  it("путь с /api/: скрипт подписи — последний сегмент", async () => {
    const { fn, calls } = fakeFetch(resign(PAYOUT_STATUS_OK, "payment_status2", KEY));
    expect((await client(fn).call("/api/payment_status2", [["pg_payment_id", "4102"]], KEY, { idempotent: true })).kind).toBe("ok");
    expect(calls[0]!.url).toBe("https://api.freedompay.kz/api/payment_status2");
    expect(verifyFields("payment_status2", [...calls[0]!.body.entries()], KEY)).toBe(true);
  });

  it("ответ с чужой подписью — исход неизвестен, а не успех", async () => {
    const { fn } = fakeFetch(INIT_PAYMENT_OK);
    const out = await client(fn).call("/init_payment.php", [], KEY);
    expect(out).toMatchObject({ kind: "unknown" });
  });

  it("ответ ok без pg_sig — исход неизвестен («Treat a response without pg_sig as an error»)", async () => {
    const { fn } = fakeFetch("<response><pg_status>ok</pg_status><pg_payment_id>1</pg_payment_id></response>");
    expect(await client(fn).call("/init_payment.php", [], KEY)).toMatchObject({ kind: "unknown" });
  });

  it("ошибка без подписи (так в документации) — отказ с кодом и текстом", async () => {
    const { fn } = fakeFetch(ERROR_UNSIGNED);
    expect(await client(fn).call("/init_payment.php", [], KEY)).toEqual({ kind: "declined", code: "1100", description: "Некорректная подпись запроса" });
  });

  it("подписанная ошибка с pg_failure_code (revoke, cancel): код берётся из pg_failure_code", async () => {
    const fields: Fields = [["pg_status", "error"], ["pg_failure_code", "99999"], ["pg_failure_description", "Отказ"], ["pg_salt", "x"]];
    const xml = `<response>${fields.map(([k, v]) => `<${k}>${String(v)}</${k}>`).join("")}<pg_sig>${signFields("revoke", fields, KEY)}</pg_sig></response>`;
    const { fn } = fakeFetch(xml);
    expect(await client(fn).call("/revoke", [], KEY)).toEqual({ kind: "declined", code: "99999", description: "Отказ" });
  });

  it("подписанная ошибка с неверной подписью — исход неизвестен", async () => {
    const xml = "<response><pg_status>error</pg_status><pg_failure_code>1</pg_failure_code><pg_sig>00000000000000000000000000000000</pg_sig></response>";
    const { fn } = fakeFetch(xml);
    expect(await client(fn).call("/revoke", [], KEY)).toMatchObject({ kind: "unknown" });
  });

  it.each([
    ["сеть", new Error("ECONNRESET")],
    ["HTTP 502", { status: 502, body: "<html>Bad Gateway</html>" }],
    ["не XML", "<html><body>oops</body></html>"],
  ])("%s — исход неизвестен; неидемпотентный запрос не повторяется", async (_, response) => {
    const { fn, calls } = fakeFetch(response, resign(INIT_PAYMENT_OK, "init_payment.php", KEY));
    expect(await client(fn).call("/init_payment.php", [], KEY)).toMatchObject({ kind: "unknown" });
    expect(calls).toHaveLength(1);
  });

  it("идемпотентный запрос статуса повторяется до statusRetries раз", async () => {
    const ok = resign(PAYOUT_STATUS_OK, "payment_status2", KEY);
    const { fn, calls } = fakeFetch(new Error("timeout"), { status: 503, body: "" }, ok);
    expect((await client(fn, 2).call("/api/payment_status2", [], KEY, { idempotent: true })).kind).toBe("ok");
    expect(calls).toHaveLength(3);
  });

  it("повторы кончились — исход неизвестен", async () => {
    const { fn, calls } = fakeFetch(new Error("a"), new Error("b"));
    expect(await client(fn, 1).call("/get_status3.php", [], KEY, { idempotent: true })).toMatchObject({ kind: "unknown" });
    expect(calls).toHaveLength(2);
  });

  it("причина неизвестного исхода не содержит ключа и тела запроса", async () => {
    const { fn } = fakeFetch(new Error(`boom ${KEY}`));
    const out = await client(fn).call("/init_payment.php", [["pg_description", "Сделка №17"]], KEY);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toContain("Сделка");
  });

  it("таймаут передаётся в fetch как AbortSignal", async () => {
    const { fn } = fakeFetch(ERROR_UNSIGNED);
    await client(fn).call("/init_payment.php", [], KEY);
    const init = (fn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
