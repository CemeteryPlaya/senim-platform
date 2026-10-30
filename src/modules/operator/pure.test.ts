import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { matchStatement } from "./reconcile";
import { slugify } from "./slug";

describe("CSV", () => {
  it("экранирует кавычки, разделитель и переносы строк", () => {
    expect(toCsv(["A", "B"], [['он сказал "да"', "1;2"], ["строка\nвторая", 5]])).toBe(
      '﻿A;B\r\n"он сказал ""да""";"1;2"\r\n"строка\nвторая";5\r\n',
    );
  });

  it("обезвреживает ячейки, которые Excel принял бы за формулу", () => {
    expect(toCsv(["A"], [["=HYPERLINK(1)"], ["+7"], ["-1"], ["@x"]])).toBe("﻿A\r\n'=HYPERLINK(1)\r\n'+7\r\n'-1\r\n'@x\r\n");
  });

  it("числа и пустые значения пишет как есть", () => {
    expect(toCsv(["A", "B"], [[-150, null]])).toBe("﻿A;B\r\n-150;\r\n");
  });
});

describe("сверка с выпиской", () => {
  const op = (key: string, amount: number, ref: string | null = `ref-${key}`) => ({
    dealId: "d1",
    kind: "RELEASE" as const,
    amount,
    idempotencyKey: key,
    externalRef: ref,
    status: "SUCCEEDED" as const,
  });
  const entry = (ref: string, amount: number, key?: string) => ({ externalRef: ref, kind: "RELEASE" as const, amount, occurredAt: new Date(0), idempotencyKey: key });

  it("сопоставляет по ключу идемпотентности, затем по ссылке банка", () => {
    const rows = matchStatement("d1", [op("k1", 100), op("k2", 200, "b2")], [entry("x", 100, "k1"), entry("b2", 200)]);
    expect(rows.map((r) => r.status)).toEqual(["MATCHED", "MATCHED"]);
  });

  it("находит расхождение суммы, пропуск в выписке и лишнюю запись банка", () => {
    const rows = matchStatement("d1", [op("k1", 100), op("k2", 200)], [entry("ref-k1", 90), entry("zzz", 50)]);
    expect(rows.map((r) => [r.idempotencyKey, r.status, r.ourAmount, r.bankAmount])).toEqual([
      ["k1", "AMOUNT_MISMATCH", 100, 90],
      ["k2", "MISSING_IN_BANK", 200, null],
      [null, "MISSING_IN_JOURNAL", null, 50],
    ]);
  });

  it("неуспешные операции в сверку не идут", () => {
    expect(matchStatement("d1", [{ ...op("k1", 100), status: "FAILED" as const }], [])).toEqual([]);
  });
});

describe("slug типа мебели", () => {
  it("транслитерирует кириллицу", () => {
    expect(slugify("Мебель для балкона")).toBe("mebel-dlya-balkona");
    expect(slugify("Шкаф-купе №2")).toBe("shkaf-kupe-2");
  });

  it("не возвращает пустую строку", () => {
    expect(slugify("!!!")).toBe("type");
  });
});
