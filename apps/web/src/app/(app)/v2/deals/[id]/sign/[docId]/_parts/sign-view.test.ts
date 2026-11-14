import { describe, expect, it } from "vitest";
import { formatDays, formatMonths } from "@/features/format/format";
import { signStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import { farWarning, isSignKind, stepView, whatRows } from "./sign-view";

const t = ru.app.deal.sign;
type Party = "CLIENT" | "EXECUTOR";
const NOW = new Date("2026-11-14T10:00:00Z");

/** Документ так, как его отдаёт `listDealDocuments` покупателю: что требуется и что уже поставлено. */
function doc(o: { mineHand?: boolean; mineEcp?: boolean; needHand?: boolean; status?: "SIGNING" | "SIGNED" | "SUPERSEDED"; stepOpen?: boolean; myParty?: Party | null } = {}) {
  const needHand = o.needHand ?? true;
  const myParty = o.myParty === undefined ? "CLIENT" : o.myParty;
  const status = o.status ?? "SIGNING";
  const open = (o.stepOpen ?? true) && status === "SIGNING";
  const hand = o.mineHand ? { signedAt: NOW, documentSha256: "x", typed: true } : null;
  const ecp = o.mineEcp ? { signedAt: NOW, signedSha256: "x", method: "EGOV_QR" as const } : null;
  return {
    status,
    signable: true,
    myParty,
    canSign: { hand: open && needHand && !o.mineHand, ecp: open && !o.mineEcp },
    parties: [
      { party: "CLIENT" as const, required: { hand: needHand, ecp: true }, hand, ecp },
      { party: "EXECUTOR" as const, required: { hand: true, ecp: true }, hand: null, ecp: null },
    ],
  };
}

const view = (d: ReturnType<typeof doc>) => stepView(d, signStep(d));

describe("шаг подписи покупателя (как в v1: сначала от руки, затем ЭЦП)", () => {
  it("ничего не подписано: шаг 1 из 2 — от руки, следом ЭЦП", () => {
    expect(view(doc())).toEqual({ kind: "hand", step: 1, total: 2, ecpAfterHand: true });
  });

  it("от руки подписано: шаг 2 из 2 — ЭЦП", () => {
    expect(view(doc({ mineHand: true }))).toEqual({ kind: "ecp", step: 2, total: 2, ecpAfterHand: false });
  });

  it("ЭЦП раньше подписи от руки (порядок любой в модуле): остаётся от руки, ЭЦП после неё не нужна", () => {
    expect(view(doc({ mineEcp: true }))).toEqual({ kind: "hand", step: 1, total: 2, ecpAfterHand: false });
  });

  it("подпись от руки не требуется: ЭЦП — единственный шаг", () => {
    expect(view(doc({ needHand: false }))).toEqual({ kind: "ecp", step: 1, total: 1, ecpAfterHand: false });
  });

  it("подписывать нечего: всё своё подписано, шаг сделки не тот, документ подписан или заменён, оператор — null", () => {
    expect(view(doc({ mineHand: true, mineEcp: true }))).toBeNull();
    expect(view(doc({ stepOpen: false }))).toBeNull();
    expect(view(doc({ status: "SIGNED" }))).toBeNull();
    expect(view(doc({ status: "SUPERSEDED" }))).toBeNull();
    expect(view(doc({ myParty: null }))).toBeNull();
  });
});

describe("«Что вы подписываете»", () => {
  const base = { number: "Д-0001/2026", executorLabel: "Исполнитель №3", buyerName: "Айгерим Сапарова", estimate: { priceTiyn: 100_000_00n, totalTiyn: 102_000_00n }, durationDays: 21, warrantyMonths: 12, readyAt: NOW };

  it("оферта: документ, стороны (мастер — подпись модуля), цена, к оплате с защитой, срок, гарантия; суммы — из сметы модуля как есть", () => {
    expect(whatRows({ kind: "CONTRACT", ...base })).toEqual([
      { label: t.what.document, value: "Оферта № Д-0001/2026" },
      { label: t.what.master, value: "Исполнитель №3" },
      { label: t.what.buyer, value: "Айгерим Сапарова" },
      { label: t.what.price, amount: 100_000_00n },
      { label: t.what.total, amount: 102_000_00n, total: true },
      { label: t.what.duration, value: formatDays(21) },
      { label: t.what.warranty, value: formatMonths(12) },
    ]);
  });

  it("акт: без суммы к оплате, с датой сдачи; без ФИО — «Вы»", () => {
    const rows = whatRows({ kind: "ACCEPTANCE_ACT", ...base, buyerName: null });
    expect(rows.map((r) => r.label)).toEqual([t.what.document, t.what.master, t.what.buyer, t.what.price, t.what.readyAt]);
    expect(rows[0]).toEqual({ label: t.what.document, value: "Акт приёмки № Д-0001/2026" });
    expect(rows[2]).toEqual({ label: t.what.buyer, value: t.what.you });
  });

  it("виды документов экрана: оферта и акт; выписка и расписка — нет", () => {
    expect(["CONTRACT", "ACCEPTANCE_ACT", "MONEY_STATEMENT", "RELEASE_RECEIPT"].filter(isSignKind)).toEqual(["CONTRACT", "ACCEPTANCE_ACT"]);
  });
});

describe("предупреждение о расстоянии (GPS) для акта", () => {
  it("дальше радиуса — текст с расстоянием и радиусом модуля", () => {
    expect(farWarning("ACCEPTANCE_ACT", { distanceM: 1800, withinRadius: false, radiusM: 500 })).toBe(t.act.far("1800", "500"));
    expect(t.act.far("1800", "500")).toContain("1800 м от адреса заказа — дальше 500 м");
  });

  it("в радиусе, без координат, без сдачи и для оферты — ничего", () => {
    expect(farWarning("ACCEPTANCE_ACT", { distanceM: 100, withinRadius: true, radiusM: 500 })).toBeNull();
    expect(farWarning("ACCEPTANCE_ACT", { distanceM: null, withinRadius: null, radiusM: 500 })).toBeNull();
    expect(farWarning("ACCEPTANCE_ACT", null)).toBeNull();
    expect(farWarning("CONTRACT", { distanceM: 1800, withinRadius: false, radiusM: 500 })).toBeNull();
  });
});

describe("тексты подписи и оплаты", () => {
  const all = JSON.stringify({ sign: t, pay: ru.app.deal.pay }, (_k, v: unknown) => (typeof v === "function" ? String((v as (...a: string[]) => string)("1", "2")) : v));

  it("без слов «платформа», «демо», «комиссия», «эскроу», «тестовый», «отклик»; о деньгах — «в банке под защитой»", () => {
    expect(all).not.toMatch(/платформ|демо|комисси|эскроу|тестов|отклик/i);
    expect(all).not.toMatch(/сч[её]т(а|у|е|ом)? сервиса|через сервис/i);
    expect(ru.app.deal.pay.where.points[0]).toContain("в банке под защитой");
    expect(ru.app.deal.pay.money.protection).toBe("Защита сделки (2%)");
  });
});
