import { describe, expect, it } from "vitest";
import { estimateRows } from "./estimate-rows";

const plain = (s: string) => s.replace(/ /g, " ");

describe("смета до оплаты (ТЗ п. 5)", () => {
  it("покупатель: стоимость заказа, защита сделки 2%, итого к оплате", () => {
    const rows = estimateRows({ party: "CLIENT", priceTiyn: 10_000_000n, extraTiyn: 200_000n, totalTiyn: 10_200_000n });
    expect(rows.map((r) => [r.label, plain(r.value), r.total])).toEqual([
      ["Стоимость заказа", "100 000 ₸", false],
      ["Защита сделки (2%)", "2 000 ₸", false],
      ["Итого к оплате", "102 000 ₸", true],
    ]);
  });

  it("мастер: сумма заказа, гарантия оплаты 4%, к выплате", () => {
    const rows = estimateRows({ party: "EXECUTOR", priceTiyn: 10_000_000n, extraTiyn: 400_000n, totalTiyn: 9_600_000n });
    expect(rows.map((r) => [r.label, plain(r.value)])).toEqual([
      ["Сумма заказа", "100 000 ₸"],
      ["Гарантия оплаты и клиента (4%)", "−4 000 ₸"],
      ["К выплате", "96 000 ₸"],
    ]);
  });
});
