import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scriptNameOf, signatureBase, signFields, verifyFields, type Fields } from "./signature";

const KEY = "test_secret_key"; // ключ из примеров документации, не настоящий

/** Примеры запросов из документации (Merchant API Overview, «Signature», и страницы методов). */
const docExamples: Array<{ name: string; script: string; fields: Fields; sig: string }> = [
  {
    name: "init_payment.php — пример Merchant API Overview",
    script: "init_payment.php",
    fields: [
      ["pg_merchant_id", "12345"],
      ["pg_order_id", "order_1001"],
      ["pg_amount", "100"],
      ["pg_currency", "KZT"],
      ["pg_description", "Order #1001"],
      ["pg_salt", "a1b2c3d4"],
    ],
    sig: "b9ad75871668ca040f80f5f6b530e6ed",
  },
  {
    name: "init_payment.php с вложенным pg_receipt_positions",
    script: "init_payment.php",
    fields: [
      ["pg_merchant_id", "12345"],
      ["pg_order_id", "order_1001"],
      ["pg_amount", "100"],
      ["pg_description", "Order #1001"],
      ["pg_salt", "a1b2c3d4"],
      ["pg_receipt_positions", [["0", [["count", "1"], ["name", "Book"], ["tax_type", "0"], ["price", "100"]]]]],
    ],
    sig: "895bb645704260ac46cf3986038cdca5",
  },
  {
    name: "reg2nonreg (POST /api/reg2nonreg) — скрипт — последний сегмент пути",
    script: "reg2nonreg",
    fields: [
      ["pg_merchant_id", "12345"],
      ["pg_order_id", "payout_1003"],
      ["pg_amount", "100"],
      ["pg_description", "Winnings"],
      ["pg_order_time_limit", "2026-12-31 23:59:59"],
      ["pg_post_link", "https://merchant.example.com/payout"],
      ["pg_back_link", "https://merchant.example.com/back"],
      ["pg_salt", "a1b2c3d4"],
    ],
    sig: "54367332d8e8c95eedefdd0d7cd7d552",
  },
  {
    name: "get_status3.php",
    script: "get_status3.php",
    fields: [["pg_merchant_id", "12345"], ["pg_payment_id", "1022123803890"], ["pg_salt", "a1b2c3d4"]],
    sig: "2586378f4f7d4ddd950fd1532eaf4fdd",
  },
  {
    name: "payment_status2 (статус выплаты)",
    script: "payment_status2",
    fields: [["pg_merchant_id", "12345"], ["pg_payment_id", "4102"], ["pg_salt", "a1b2c3d4"]],
    sig: "db5ed2cbb64039418a811ef229635619",
  },
  {
    name: "do_capture.php",
    script: "do_capture.php",
    fields: [["pg_merchant_id", "12345"], ["pg_payment_id", "1023122203594"], ["pg_salt", "a1b2c3d4"]],
    sig: "6904b1ae1e4017a4e1ba88732d8db7c8",
  },
  {
    name: "revoke (возврат)",
    script: "revoke",
    fields: [["pg_merchant_id", "12345"], ["pg_payment_id", "1023122203651"], ["pg_salt", "a1b2c3d4"]],
    sig: "c9b6030e425d4d5a4d81cdb0ac09a4e5",
  },
  {
    name: "cancel (отмена)",
    script: "cancel",
    fields: [["pg_merchant_id", "12345"], ["pg_payment_id", "1023122203626"], ["pg_salt", "a1b2c3d4"]],
    sig: "e91d9a1ffcd55f0aeb3dc149651410ea",
  },
];

describe("pg_sig по алгоритму документации", () => {
  it.each(docExamples)("$name → ровно подпись из документации", ({ script, fields, sig }) => {
    expect(signFields(script, fields, KEY)).toBe(sig);
  });

  it("строка подписи примера Overview совпадает с документацией символ в символ", () => {
    expect(signatureBase(docExamples[0]!.script, docExamples[0]!.fields, KEY)).toBe(
      "init_payment.php;100;KZT;Order #1001;12345;order_1001;a1b2c3d4;test_secret_key",
    );
    expect(signatureBase(docExamples[1]!.script, docExamples[1]!.fields, KEY)).toBe(
      "init_payment.php;100;Order #1001;12345;order_1001;1;Book;100;0;a1b2c3d4;test_secret_key",
    );
  });

  it("pg_sig во входе не участвует в подписи, но занимает позицию, как в коде документации", () => {
    const base = docExamples[0]!;
    expect(signFields(base.script, [...base.fields, ["pg_sig", "что угодно"]], KEY)).toBe(base.sig);
  });

  it("сортировка по сплющенным именам с трёхзначным индексом, как в коде документации, а не по голым ключам", () => {
    // «a-b» короче-префикс «a»: по голым ключам «a» < «a-b», по именам кода «a001» > «a-b002» ('0' > '-').
    expect(signatureBase("s", [["a", "1"], ["a-b", "2"]], "k")).toBe("s;2;1;k");
    // Номер позиции — часть имени: «x1001» > «x10002», хотя «x1» < «x10».
    expect(signatureBase("s", [["x1", "1"], ["x10", "10"]], "k")).toBe("s;10;1;k");
  });

  it("свойство: порядок полей во входе не влияет на подпись (ключи — латиница и подчёркивание)", () => {
    const key = fc.stringMatching(/^pg_[a-z_]{1,12}$/);
    const fields = fc.uniqueArray(fc.tuple(key, fc.string()), { selector: ([k]) => k, minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(fields, (list) => {
        const reversed = [...list].reverse();
        return signFields("init_payment", list, KEY) === signFields("init_payment", reversed, KEY);
      }),
    );
  });

  it("свойство: изменение любого значения, имени скрипта или ключа меняет подпись", () => {
    const base = docExamples[0]!;
    base.fields.forEach(([name], i) => {
      const changed: Fields = base.fields.map(([k, v], j) => [k, j === i ? `${String(v)}x` : v]);
      expect(signFields(base.script, changed, KEY), name).not.toBe(base.sig);
    });
    expect(signFields("init_payment", base.fields, KEY)).not.toBe(base.sig);
    expect(signFields(base.script, base.fields, "other_key")).not.toBe(base.sig);
  });
});

describe("проверка подписи входящих данных", () => {
  const signed = (fields: Fields): Fields => [...fields, ["pg_sig", signFields("result", fields, KEY)]];
  const fields: Fields = [["pg_order_id", "hold:d1"], ["pg_result", "1"], ["pg_salt", "s1"]];

  it("верная подпись — true", () => {
    expect(verifyFields("result", signed(fields), KEY)).toBe(true);
  });

  it("подпись в верхнем регистре, другая длина, нет подписи, подмена поля — false", () => {
    const sig = signFields("result", fields, KEY);
    expect(verifyFields("result", [...fields, ["pg_sig", sig.toUpperCase()]], KEY)).toBe(false);
    expect(verifyFields("result", [...fields, ["pg_sig", sig.slice(1)]], KEY)).toBe(false);
    expect(verifyFields("result", fields, KEY)).toBe(false);
    const tampered: Fields = signed(fields).map(([k, v]) => [k, k === "pg_result" ? "0" : v]);
    expect(verifyFields("result", tampered, KEY)).toBe(false);
  });

  it("pg_sig верхнего уровня с вложенным значением — не подпись", () => {
    expect(verifyFields("result", [...fields, ["pg_sig", [["x", signFields("result", fields, KEY)]]]], KEY)).toBe(false);
  });

  it("вложенный pg_sig не считается подписью ответа", () => {
    expect(verifyFields("result", [...fields, ["x", [["pg_sig", signFields("result", fields, KEY)]]]], KEY)).toBe(false);
  });
});

describe("имя скрипта — последний сегмент пути URL", () => {
  it.each([
    ["https://api.freedompay.kz/init_payment.php", "init_payment.php"],
    ["https://api.freedompay.kz/api/reg2nonreg", "reg2nonreg"],
    ["https://merchant.example.com/payment/result", "result"],
    ["https://merchant.example.com/payment/result/", ""],
    ["/api/payment_status2", "payment_status2"],
  ])("%s → «%s»", (url, script) => {
    expect(scriptNameOf(url)).toBe(script);
  });
});
