import { describe, expect, it } from "vitest";
import { estimateRows } from "./estimate-rows";

const plain = (s: string) => s.replace(/ /g, " ");

describe("смета до оплаты (ТЗ п. 5)", () => {
  it("покупатель: стоимость заказа и итого к оплате — без доплат (ADR-015)", () => {
    const rows = estimateRows({ party: "CLIENT", priceTiyn: 10_000_000n, extraTiyn: 0n, totalTiyn: 10_000_000n });
    expect(rows.map((r) => [r.label, plain(r.value), r.total])).toEqual([
      ["Стоимость заказа", "100 000 ₸", false],
      ["Итого к оплате", "100 000 ₸", true],
    ]);
  });

  it("мастер: сумма заказа, гарантия оплаты 6%, к выплате", () => {
    const rows = estimateRows({ party: "EXECUTOR", priceTiyn: 10_000_000n, extraTiyn: 600_000n, totalTiyn: 9_400_000n });
    expect(rows.map((r) => [r.label, plain(r.value)])).toEqual([
      ["Сумма заказа", "100 000 ₸"],
      ["Гарантия оплаты и клиента (6%)", "−6 000 ₸"],
      ["К выплате", "94 000 ₸"],
    ]);
  });
});
