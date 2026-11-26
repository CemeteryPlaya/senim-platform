import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { accountLine, ibanProblem, payoutNow, payoutSchema } from "./payout-view";

const t = ru.app.masterCompany.payout;
const IBAN = "KZ86125KZT5004100100";
const GROUPED = "kz86 125k zt50 0410 0100";

describe("проверка номера счёта (одни правила в браузере и на сервере)", () => {
  it("верный номер — в любом виде: с пробелами и строчными буквами", () => {
    expect(ibanProblem(IBAN)).toBeNull();
    expect(ibanProblem(GROUPED)).toBeNull();
  });

  it("пусто, не тот формат, ошибка в цифрах — свои тексты", () => {
    expect(ibanProblem("  ")).toBe(t.form.errors.empty);
    expect(ibanProblem("KZ12")).toBe(t.form.errors.format);
    expect(ibanProblem("RU86125KZT5004100100")).toBe(t.form.errors.format);
    expect(ibanProblem("KZ87125KZT5004100100")).toBe(t.form.errors.checksum);
  });

  it("схема действия отдаёт нормализованный номер или ошибку у поля iban", () => {
    const ok = payoutSchema.safeParse({ iban: GROUPED });
    expect(ok.success && ok.data.iban).toBe(IBAN);
    const bad = payoutSchema.safeParse({ iban: "KZ87125KZT5004100100" });
    expect(!bad.success && bad.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([`iban: ${t.form.errors.checksum}`]);
    expect(payoutSchema.safeParse({ iban: IBAN, extra: 1 }).success).toBe(false);
  });
});

describe("что показывает экран", () => {
  it("счёт — «KZ •••• 0100» или «Не указан»; полного номера в строке нет", () => {
    expect(accountLine("0100")).toBe("KZ •••• 0100");
    expect(accountLine("0100")).not.toContain(IBAN);
    expect(accountLine(null)).toBe(t.none);
  });

  it("карточка: не указан, указан, оплата в обработке (смена закрыта)", () => {
    expect(payoutNow(null, false).title).toBe(t.now.none.title);
    // Указан — номер (последние 4 знака) в заголовке карточки, отдельной строки «Счёт» нет.
    expect(payoutNow("0100", false)).toEqual({ title: "Счёт KZ •••• 0100", body: t.now.set.body });
    expect(payoutNow("0100", true).title).toBe(t.now.locked.title);
    expect(payoutNow(null, true).title).toBe(t.now.locked.title);
  });
});
