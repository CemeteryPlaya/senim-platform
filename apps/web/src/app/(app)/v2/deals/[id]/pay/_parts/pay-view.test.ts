import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { partyEstimate, type MoneyBlock } from "@/modules/payments";
import { isAgreed, paidToast, payLabel, payMoney, transferAmount } from "./pay-view";

const t = ru.app.deal.pay.money;
const p = ru.app.deal.pay;
const block = (payment: "none" | "PENDING" | "FAILED"): MoneyBlock => ({ kind: "awaiting", payment, bankBalanceTiyn: 0n, isTest: false });

describe("деньги экрана оплаты — смета модуля как есть", () => {
  it("цена по оферте и итого с пояснением; главная сумма — итого, без доплат (ADR-015)", () => {
    const e = partyEstimate("CLIENT", 1_000_000_01n);
    expect(payMoney(e, block("none"))).toEqual({
      amount: 1_000_000_01n,
      rows: [
        { label: t.price, amount: 1_000_000_01n },
        { label: t.total, amount: 1_000_000_01n, total: true, explain: true },
      ],
      failed: false,
    });
  });

  it("прошлая оплата не прошла — пометка; ждёт банк или не начиналась — нет", () => {
    const e = partyEstimate("CLIENT", 100_000_00n);
    expect(payMoney(e, block("FAILED")).failed).toBe(true);
    expect(payMoney(e, block("PENDING")).failed).toBe(false);
  });
});

describe("оплата переводом по реквизитам (ручной провайдер) и онлайн", () => {
  it("подпись кнопки: «Оплатить переводом N ₸» и «Оплатить N ₸»", () => {
    expect(payLabel("102 000 ₸", true)).toBe("Оплатить переводом 102 000 ₸");
    expect(payLabel("102 000 ₸", false)).toBe("Оплатить 102 000 ₸");
  });

  it("тост после: перевод — «Оплата оформлена — переведите деньги по реквизитам» без суммы при любом статусе; онлайн — по итогу операции", () => {
    expect(paidToast({ status: "PENDING" }, true)).toBe("Оплата оформлена — переведите деньги по реквизитам");
    expect(paidToast({ status: "SUCCEEDED" }, false)).toBe(p.done.SUCCEEDED);
    expect(paidToast({ status: "PENDING" }, false)).toBe(p.done.PENDING);
  });
});

describe("отметка согласия и редакция текста", () => {
  it("отметка действует только для той редакции, при которой её поставили: новая редакция — отметки нет", () => {
    expect(isAgreed(null, "2026-11-11-d1")).toBe(false);
    expect(isAgreed("2026-11-11-d1", "2026-11-11-d1")).toBe(true);
    expect(isAgreed("2026-11-11-d1", "2026-12-01-d2")).toBe(false);
  });

  it("отметка — «для этой сделки» (согласие хранится по сделке); без обещаний уведомить", () => {
    expect(p.consent.agree).toBe("Согласен(на) на передачу данных банку для этой сделки");
    expect(p.waitMaster.body).not.toMatch(/сообщим/);
    expect(p.where.points.join(" ")).not.toMatch(/на (вашу )?карту/);
    expect(p.where.points[0]).toBe("Деньги будут лежать в банке под защитой.");
  });
});

describe("transferAmount", () => {
  it("цифры без пробелов и знака валюты, тиыны — только если есть", () => {
    expect(transferAmount(122_400_000n)).toBe("1224000");
    expect(transferAmount(10_105n)).toBe("101.05");
    expect(transferAmount(10_150n)).toBe("101.50");
  });
});

describe("назначение перевода", () => {
  it("сделка и номер оферты из данных; без оферты — только сделка", () => {
    expect(ru.app.deal.pay.manual.purpose(4, "Д-0004/2026")).toBe("Оплата по сделке №4, оферта Д-0004/2026");
    expect(ru.app.deal.pay.manual.purpose(4, null)).toBe("Оплата по сделке №4");
  });
});
