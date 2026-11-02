import { randomBytes } from "node:crypto";
import { scriptNameOf, signFields, verifyFields, type Fields } from "./signature";
import { fieldText, parseXmlFields } from "./xml";

/**
 * HTTP-вызовы Merchant API Freedom Pay (https://docs.freedompay.kz/overview-741636m0.md):
 * POST `application/x-www-form-urlencoded`, ответ — XML `<response>`, «HTTP status is always 200».
 * Подписанный ответ проверяется тем же скриптом и ключом, что запрос. «Treat a response without
 * `pg_sig` as an error»: неподписанный `ok` — не подтверждение. Ошибки `pg_status=error`
 * документация не подписывает (коды 1100, 94031, 11005…) — они отказ, а не подтверждение.
 *
 * В причины и исключения не попадают ключи, тело запроса и ответа: только путь и код.
 */

export type ApiOutcome =
  /** Подписанный ответ с верной подписью, `pg_status` ≠ `error`. */
  | { kind: "ok"; fields: Fields }
  /** Freedom Pay ответил отказом: код из `pg_error_code` или `pg_failure_code`. */
  | { kind: "declined"; code: string; description: string }
  /** Исход неизвестен: сеть, таймаут, не XML, подпись не сошлась. Проверьте статус, прежде чем повторять. */
  | { kind: "unknown"; reason: string };

export type ClientConfig = {
  apiUrl: string;
  merchantId: string;
  timeoutMs: number;
  /** Сколько раз повторить идемпотентный запрос (статус) при неизвестном исходе. */
  statusRetries: number;
};

export type ClientDeps = {
  fetch: typeof fetch;
  /** `pg_salt`: «random Latin letters and digits». */
  salt: () => string;
  sleep: (ms: number) => Promise<void>;
};

export const defaultSalt = () => randomBytes(8).toString("hex");
export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MIN_TIYN = 1n;
/** «0.01 to 99999999, up to 2 decimals» (init_payment, reg2nonreg). */
const MAX_TIYN = 9_999_999_999n;

/** Тиыны → сумма в формате документации: точка, до 2 знаков, без хвостовых нулей («100», «100.5»). */
export function tiynToAmount(tiyn: bigint): string {
  if (tiyn < MIN_TIYN || tiyn > MAX_TIYN) throw new RangeError("сумма вне диапазона Freedom Pay 0.01…99999999");
  const whole = tiyn / 100n;
  const frac = tiyn % 100n;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Сумма из ответа («100», «100.50», «-40.00») → тиыны; не сумма — null. */
export function amountToTiyn(text: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const tiyn = BigInt(m[2]!) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -tiyn : tiyn;
}

/** Отказ: «pg_error_code» у неподписанных ошибок, «pg_failure_code» у подписанных (revoke, cancel, to_iban). */
function declined(fields: Fields): ApiOutcome {
  const code = fieldText(fields, "pg_error_code") ?? fieldText(fields, "pg_failure_code") ?? "";
  const description = fieldText(fields, "pg_error_description") ?? fieldText(fields, "pg_failure_description") ?? "";
  return { kind: "declined", code, description };
}

function interpret(path: string, text: string, key: string): ApiOutcome {
  const doc = parseXmlFields(text);
  if (!doc || doc.root !== "response") return { kind: "unknown", reason: `${path}: ответ не XML <response>` };
  const signed = fieldText(doc.fields, "pg_sig") !== undefined;
  if (signed && !verifyFields(scriptNameOf(path), doc.fields, key)) {
    return { kind: "unknown", reason: `${path}: подпись ответа не сошлась` };
  }
  if (fieldText(doc.fields, "pg_status") === "error") return declined(doc.fields);
  if (!signed) return { kind: "unknown", reason: `${path}: ответ без подписи` };
  return { kind: "ok", fields: doc.fields };
}

export function createFreedomPayClient(config: ClientConfig, deps: ClientDeps) {
  const base = config.apiUrl.replace(/\/+$/, "");

  async function once(path: string, params: Fields, key: string): Promise<ApiOutcome> {
    const fields: Fields = [["pg_merchant_id", config.merchantId], ...params, ["pg_salt", deps.salt()]];
    const body = new URLSearchParams(fields.map(([k, v]) => [k, String(v)]));
    body.append("pg_sig", signFields(scriptNameOf(path), fields, key));
    let response: Response;
    try {
      response = await deps.fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { kind: "unknown", reason: `${path}: ${timeout ? "таймаут" : "сеть недоступна"}` };
    }
    if (response.status !== 200) return { kind: "unknown", reason: `${path}: HTTP ${response.status}` };
    return interpret(path, await response.text(), key);
  }

  return {
    /**
     * Вызов метода. Параметры — только строки (вложенность — для подписи). Повтор при неизвестном
     * исходе — только для `idempotent` (запросы статуса): повтор создания платежа или выплаты решает вызывающий.
     */
    async call(path: string, params: Fields, key: string, options: { idempotent?: boolean } = {}): Promise<ApiOutcome> {
      const attempts = options.idempotent ? config.statusRetries + 1 : 1;
      let outcome: ApiOutcome = { kind: "unknown", reason: `${path}: запрос не отправлен` };
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) await deps.sleep(500 * 2 ** (attempt - 1));
        outcome = await once(path, params, key);
        if (outcome.kind !== "unknown") return outcome;
      }
      return outcome;
    },
  };
}

export type FreedomPayClient = ReturnType<typeof createFreedomPayClient>;
