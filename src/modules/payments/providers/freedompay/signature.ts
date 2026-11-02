import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Подпись `pg_sig` Freedom Pay — строго по «Signature» в Merchant API Overview
 * (https://docs.freedompay.kz/overview-741636m0.md):
 *
 * 1. Первый элемент — имя скрипта: «последний сегмент пути URL, ровно как в URL запроса»
 *    (`init_payment.php`, `reg2nonreg`, `result` для `https://merchant.example.com/payment/result`).
 * 2. Значения всех параметров, кроме `pg_sig` (включая `pg_salt` и параметры без префикса `pg_`),
 *    по алфавиту имён. Вложенные массивы сплющиваются так, как в коде примеров документации (PHP/Python):
 *    имя = родитель + ключ + трёхзначный номер позиции на своём уровне (с 1; `pg_sig` позицию занимает),
 *    сортируются сплющенные имена — поэтому порядок совпадает с кодом документации и в краевых случаях.
 * 3. В конце — секретный ключ: платёжный для приёма, выплатной для reg2nonreg, to_iban, payment_status2.
 * 4. Склейка через «;», MD5, 32 строчных hex-символа.
 *
 * Сверено со всеми примерами запросов документации (signature.test.ts).
 */

/** Поля запроса или ответа в порядке получения; значение — строка или вложенные поля. */
export type FieldValue = string | Fields;
export type Fields = ReadonlyArray<readonly [string, FieldValue]>;

const SIG = "pg_sig";

function flatten(fields: Fields, parent: string, out: Array<[string, string]>) {
  fields.forEach(([key, value], index) => {
    if (key === SIG) return;
    const name = `${parent}${key}${String(index + 1).padStart(3, "0")}`;
    if (typeof value === "string") out.push([name, value]);
    else flatten(value, name, out);
  });
}

/** Строка до хэширования: `script;значения…;ключ`. Сортировка — по кодовым точкам, как sorted() в Python. */
export function signatureBase(script: string, fields: Fields, secretKey: string): string {
  const flat: Array<[string, string]> = [];
  flatten(fields, "", flat);
  flat.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [script, ...flat.map(([, value]) => value), secretKey].join(";");
}

export function signFields(script: string, fields: Fields, secretKey: string): string {
  return createHash("md5").update(signatureBase(script, fields, secretKey), "utf8").digest("hex");
}

/** Верна ли подпись `pg_sig` верхнего уровня. Сравнение за постоянное время; нет подписи — false. */
export function verifyFields(script: string, fields: Fields, secretKey: string): boolean {
  const given = fields.find(([key, value]) => key === SIG && typeof value === "string")?.[1];
  if (typeof given !== "string") return false;
  const expected = Buffer.from(signFields(script, fields, secretKey));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Имя скрипта для подписи: последний сегмент пути (URL или путь). URL на «/» — пустое имя (так в документации). */
export function scriptNameOf(urlOrPath: string): string {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath) ? new URL(urlOrPath).pathname : urlOrPath.split(/[?#]/)[0]!;
  return path.slice(path.lastIndexOf("/") + 1);
}
