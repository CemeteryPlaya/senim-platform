import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevealPurpose, SigningSide } from "@/gen/senim/identity/v1/identity_pb";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal } from "../../../test/factories/deal";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { revealParties, verifySignerIin } from "./reveal";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

/**
 * Раскрытие ПДн сторон через identity (RevealPartyDetails): identity раскрывает любого пользователя любому вызову web,
 * поэтому web сам проверяет, что раскрываются только стороны сделки reference_id и что действующее лицо — её сторона
 * или оператор (его сессия уходит в identity, второй фактор проверяет identity).
 */
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const reveals = () => identityFake.calls.filter((c) => c.method === "revealPartyDetails");

beforeEach(() => freshBrowser());

describe("revealParties", () => {
  it("стороны сделки — открытые реквизиты из identity; системный вызов (\"system\") — без сессии, с целью и сделкой", async () => {
    const f = await makeDeal();
    const parties = await revealParties([f.client.id, f.executor.id], "CONTRACT", f.dealId, "system");

    expect(reveals()).toHaveLength(1);
    expect(reveals()[0].request).toMatchObject({ userIds: [f.client.id, f.executor.id], purpose: RevealPurpose.CONTRACT, referenceId: f.dealId, actorSessionToken: "" });
    expect(parties.get(f.client.id)).toMatchObject({ userId: f.client.id, fullName: f.client.fullName, iin: identityFake.personIinOf(f.client.id), legalForm: null });
    expect(parties.get(f.executor.id)).toMatchObject({
      legalForm: "IP",
      binIin: identityFake.partyNumbersOf(f.executor.id)?.binIin,
      signerIin: null,
      payoutIban: null,
    });
    expect(identityFake.auditEvents.filter((e) => e.action === "pii.revealed").map((e) => e.userId)).toEqual([f.client.id, f.executor.id]);
  });

  it("не сторона сделки не получает реквизитов: identity не вызывается", async () => {
    const f = await makeDeal();
    const stranger = await makeExecutor();
    expect(await code(revealParties([f.client.id, stranger.id], "CONTRACT", f.dealId, "system"))).toBe("FORBIDDEN");
    expect(await code(revealParties([stranger.id], "PAYOUT", f.dealId, "system"))).toBe("FORBIDDEN");
    expect(await code(revealParties([f.executor.id], "PAYOUT", "no-such-deal", "system"))).toBe("FORBIDDEN");
    expect(await code(revealParties([], "PAYOUT", f.dealId, "system"))).toBe("FORBIDDEN");
    // Действующее лицо — не сторона и не оператор: даже реквизиты сторон этой сделки ему не раскрываются.
    const outsider = await makeClient();
    await signInAs(outsider);
    expect(await code(revealParties([f.executor.id], "RELEASE_RECEIPT", f.dealId, outsider))).toBe("FORBIDDEN");
    expect(reveals()).toHaveLength(0);
  });

  it("оператор: его сессия уходит в identity; без второго фактора — mfa_required", async () => {
    const f = await makeDeal();
    const operator = await makeOperator();
    const token = await signInAs(operator);
    const parties = await revealParties([f.client.id, f.executor.id], "RELEASE_RECEIPT", f.dealId, operator);
    expect(parties.size).toBe(2);
    expect(reveals()[0].request).toMatchObject({ actorSessionToken: token, purpose: RevealPurpose.RELEASE_RECEIPT });

    await signInAs(operator, "OPERATOR", { mfaVerifiedAt: null });
    expect(await code(revealParties([f.client.id], "RELEASE_RECEIPT", f.dealId, operator))).toBe("MFA_REQUIRED");
  });

  it("действующее лицо без сессии (cookie нет) — не вошёл", async () => {
    const f = await makeDeal();
    expect(await code(revealParties([f.client.id], "CONTRACT", f.dealId, await makeOperator()))).toBe("UNAUTHENTICATED");
    expect(reveals()).toHaveLength(0);
  });

  it("пользователя нет в identity — его нет и в ответе (сделка могла пережить пользователя)", async () => {
    const f = await makeDeal();
    identityFake.reset();
    expect((await revealParties([f.client.id, f.executor.id], "PAYOUT", f.dealId, "system")).size).toBe(0);
  });
});

describe("revealParties: действующее лицо обязательно", () => {
  it("пропустить actor нельзя — тип требует пользователя или \"system\"", () => {
    // @ts-expect-error actor обязателен: "system" передаётся только явно, на системных путях без пользователя
    const call = () => revealParties([], "CONTRACT", "deal");
    expect(typeof call).toBe("function");
  });
});

describe("verifySignerIin", () => {
  it("заказчик — с ИИН личности, исполнитель — с подписантом стороны (ИП — ИИН стороны)", async () => {
    const f = await makeDeal();
    const clientIin = identityFake.personIinOf(f.client.id);
    const executorIin = identityFake.partyNumbersOf(f.executor.id)!.binIin;
    expect(await verifySignerIin(f.client.id, clientIin, "CLIENT")).toBe(true);
    expect(await verifySignerIin(f.client.id, executorIin, "CLIENT")).toBe(false);
    expect(await verifySignerIin(f.executor.id, executorIin, "EXECUTOR")).toBe(true);
    expect(await verifySignerIin(f.executor.id, clientIin, "EXECUTOR")).toBe(false);
    // Заказчик без стороны на стороне исполнителя — не совпало.
    expect(await verifySignerIin(f.client.id, clientIin, "EXECUTOR")).toBe(false);
    const sides = identityFake.calls.filter((c) => c.method === "verifySignerIin").map((c) => (c.request as { side: SigningSide }).side);
    expect(sides).toEqual([SigningSide.CLIENT, SigningSide.CLIENT, SigningSide.EXECUTOR, SigningSide.EXECUTOR, SigningSide.EXECUTOR]);
  });
});
