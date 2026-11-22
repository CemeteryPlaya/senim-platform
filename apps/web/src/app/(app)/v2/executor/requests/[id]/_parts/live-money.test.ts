import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { kztToTiyn } from "@/modules/payments/client";
import { partyEstimate } from "@/modules/payments";
import { formMoney, liveMoney } from "./live-money";
import { MAX_PRICE_KZT } from "./schema";

const t = ru.app.masterOffer.money;

describe("живой расчёт «Вы получите» в форме предложения", () => {
  // Цены в целых тенге (поле формы не принимает тиыны): разные порядки, нечётные и простые числа и обе границы поля.
  // Округление вниз до тиына на них не срабатывает (4% от целых тенге — целые тиыны); его проверяют тесты payments.
  const PRICES = [1, 3, 7, 13, 99, 101, 999, 12_345, 98_765, 333_333, 500_000, 980_000, 1_180_000, 7_777_777, MAX_PRICE_KZT];

  it.each(PRICES)("%d ₸ — до тиына равен partyEstimate(\"EXECUTOR\") модуля (итог на сервере)", (kzt) => {
    const e = partyEstimate("EXECUTOR", kztToTiyn(kzt));
    expect(liveMoney(String(kzt))).toEqual({ priceTiyn: e.priceTiyn, guaranteeTiyn: e.extraTiyn, youGetTiyn: e.totalTiyn });
  });

  it("разделители разрядов — та же цена; не цена и сверх потолка — расчёта нет", () => {
    expect(liveMoney("1 180 000")).toEqual(liveMoney("1180000"));
    for (const raw of ["", "0", "12,5", "-1", "абв", String(MAX_PRICE_KZT + 1)]) expect(liveMoney(raw)).toBeNull();
  });

  it("смета формы: «Цена покупателю → Гарантия оплаты и клиента (6%) → Вы получите», крупно — «Вы получите»", () => {
    const e = partyEstimate("EXECUTOR", kztToTiyn(1_000_000));
    expect(formMoney("1 000 000")).toEqual({
      title: t.title,
      amountTiyn: e.totalTiyn,
      rows: [
        { label: t.price.form, amountTiyn: e.priceTiyn },
        { label: "Гарантия оплаты и клиента (6%)", amountTiyn: e.extraTiyn, explain: true },
        { label: "Вы получите", amountTiyn: e.totalTiyn, total: true },
      ],
    });
    expect(e.totalTiyn).toBe(940_000_00n);
    expect(formMoney("")).toBeNull();
  });

  it("мастеру не показываются защита сделки покупателя (2%) и сумма к оплате покупателем", () => {
    const view = formMoney("1 000 000");
    const shown = JSON.stringify(view, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    expect(shown).not.toMatch(/2\s?%|защит[аыеу] сделки|к оплате/i);
    // Сумма к оплате покупателем (X + 2%) нигде не стоит среди сумм.
    expect(view?.rows.map((r) => r.amountTiyn)).not.toContain(102_000_000n);
  });
});
