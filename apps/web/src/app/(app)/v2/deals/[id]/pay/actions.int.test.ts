import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentKind } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../test/factories";
import { dealAt, journalOf, makeDeal, signContract } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { identityFake } from "../../../../../../../test/stubs/identity";
import { cancelDeal, openDispute } from "@/modules/deal-core";
import { giveBankConsentAction, payAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.deal.pay.errors;
const VERSION = ru.consent.documents.BANK_TRANSFER.version;

beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

/** Оферта заключена; согласия на передачу банку — только у перечисленных сторон. */
async function signed(bankConsents: readonly ("CLIENT" | "EXECUTOR")[] = ["CLIENT", "EXECUTOR"], provider: "mock" | "manual" = "mock") {
  const f = await makeDeal({ bankConsents, provider });
  await signContract(f.dealId);
  await signInAs(f.client);
  return f;
}

const holds = async (dealId: string) => (await journalOf(dealId)).filter((e) => e.type === "HOLD");
const bankConsentOf = (userId: string, dealId: string) => identityFake.consentsOf(userId).filter((c) => c.kind === ConsentKind.BANK_TRANSFER && c.referenceId === dealId);

describe("payAction", () => {
  it("двойное нажатие (два параллельных вызова) — одна операция HOLD в журнале, оба ответа одинаковые", async () => {
    const f = await signed();
    const results = await Promise.all([payAction({ dealId: f.dealId }), payAction({ dealId: f.dealId })]);
    expect(results).toEqual([
      { ok: true, data: { status: "SUCCEEDED", redirectUrl: null } },
      { ok: true, data: { status: "SUCCEEDED", redirectUrl: null } },
    ]);
    expect(await holds(f.dealId)).toHaveLength(1);
    expect((await holds(f.dealId))[0]?.amountTiyn).toBe((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).buyerTotalTiyn);
    // Повтор позже — та же операция, не вторая.
    expect(await payAction({ dealId: f.dealId })).toEqual({ ok: true, data: { status: "SUCCEEDED", redirectUrl: null } });
    expect(await holds(f.dealId)).toHaveLength(1);
  });

  it("manual: оплата ждёт подтверждения банка (PENDING), страницы банка нет", async () => {
    const f = await signed(["CLIENT", "EXECUTOR"], "manual");
    expect(await payAction({ dealId: f.dealId })).toEqual({ ok: true, data: { status: "PENDING", redirectUrl: null } });
    expect((await holds(f.dealId)).map((h) => h.status)).toEqual(["PENDING"]);
  });

  it("manual: двойное нажатие — одна операция HOLD (PENDING), оба ответа одинаковые", async () => {
    const f = await signed(["CLIENT", "EXECUTOR"], "manual");
    const results = await Promise.all([payAction({ dealId: f.dealId }), payAction({ dealId: f.dealId })]);
    expect(results).toEqual([
      { ok: true, data: { status: "PENDING", redirectUrl: null } },
      { ok: true, data: { status: "PENDING", redirectUrl: null } },
    ]);
    expect((await holds(f.dealId)).map((h) => h.status)).toEqual(["PENDING"]);
  });

  it("открыт спор — отказ «оплата недоступна, пока спор рассматривает оператор», вторая операция не создаётся", async () => {
    const f = await dealAt("PAID_HOLD");
    await openDispute(f.client, { dealId: f.dealId, reason: "OTHER", description: "Мастер не выходит на связь" });
    await signInAs(f.client);
    expect(await payAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "CONFLICT", error: t.dispute });
    expect(await holds(f.dealId)).toHaveLength(1);
  });

  it("отметка согласия и оплата одним нажатием: согласие записано к этой сделке, операция одна", async () => {
    const f = await signed(["EXECUTOR"]);
    const results = await Promise.all([
      payAction({ dealId: f.dealId, agreed: "on", version: VERSION }),
      payAction({ dealId: f.dealId, agreed: "on", version: VERSION }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(bankConsentOf(f.client.id, f.dealId)).toHaveLength(1);
    expect(await holds(f.dealId)).toHaveLength(1);
  });

  it("без своей отметки — отказ у отметки, журнал пуст", async () => {
    const f = await signed(["EXECUTOR"]);
    expect(await payAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "CONFLICT", error: t.consentMissing, fieldErrors: { agreed: [t.consentMissing] } });
    expect(await journalOf(f.dealId)).toEqual([]);
  });

  it("мастер не дал согласие — понятный отказ, даже с отметкой покупателя; журнал пуст", async () => {
    const f = await signed(["CLIENT"]);
    expect(await payAction({ dealId: f.dealId, agreed: "on", version: VERSION })).toMatchObject({ ok: false, code: "CONFLICT", error: t.masterConsent });
    expect(await journalOf(f.dealId)).toEqual([]);
  });

  it("показанная редакция согласия не текущая — «текст обновился», оплаты нет", async () => {
    const f = await signed(["EXECUTOR"]);
    expect(await payAction({ dealId: f.dealId, agreed: "on", version: "old-1" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.consentChanged });
    expect(bankConsentOf(f.client.id, f.dealId)).toHaveLength(0);
    expect(await journalOf(f.dealId)).toEqual([]);
  });

  it("оферта не подписана — отказ «сначала оферту подписывают обе стороны»", async () => {
    const f = await makeDeal();
    await signInAs(f.client);
    expect(await payAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "CONFLICT", error: t.notSigned });
    expect(await journalOf(f.dealId)).toEqual([]);
  });

  it("сделка отменена — «уже на другом шаге»", async () => {
    const f = await signed();
    await cancelDeal(f.client, { dealId: f.dealId });
    expect(await payAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "CONFLICT", error: t.changed });
    expect(await journalOf(f.dealId)).toEqual([]);
  });

  it("уже оплачено — повтор отвечает той же операцией", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.client);
    expect(await payAction({ dealId: f.dealId })).toEqual({ ok: true, data: { status: "SUCCEEDED", redirectUrl: null } });
    expect(await holds(f.dealId)).toHaveLength(1);
  });

  it("чужая сделка — «не найдена»; мастер оплатить не может", async () => {
    const f = await signed();
    await signInAs(await makeClient());
    expect(await payAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "NOT_FOUND", error: t.notFound });
    await signInAs(f.executor);
    expect((await payAction({ dealId: f.dealId })).ok).toBe(false);
    expect(await journalOf(f.dealId)).toEqual([]);
  });
});

describe("giveBankConsentAction (заранее, пока мастер не дал своё)", () => {
  it("без отметки — ошибка у отметки; с отметкой — согласие к этой сделке, оплаты нет; повтор безопасен", async () => {
    const f = await signed([]);
    // Отметки нет: так придёт форма без поставленной галочки (вход проверяет схема действия).
    const unchecked = { dealId: f.dealId, version: VERSION } as unknown as Parameters<typeof giveBankConsentAction>[0];
    expect(await giveBankConsentAction(unchecked)).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { agreed: [t.consentMissing] } });
    expect(await giveBankConsentAction({ dealId: f.dealId, agreed: "on", version: VERSION })).toEqual({ ok: true, data: undefined });
    expect(await giveBankConsentAction({ dealId: f.dealId, agreed: "on", version: VERSION })).toMatchObject({ ok: true });
    expect(bankConsentOf(f.client.id, f.dealId)).toHaveLength(1);
    expect(await journalOf(f.dealId)).toEqual([]);
  });
});
