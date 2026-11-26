import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelDeal } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeClient } from "../../../test/factories";
import { dealAt, makeDeal } from "../../../test/factories/deal";
import { getDealAddress, setDealAddress } from "./index";

// Запись журнала можно уронить: так видно, что адрес и аудит — одна транзакция.
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("@/modules/audit", async (importActual) => {
  const actual = await importActual<typeof import("@/modules/audit")>();
  return {
    ...actual,
    recordAudit: (...args: Parameters<typeof actual.recordAudit>) => (audit.fail ? Promise.reject(new Error("журнал недоступен")) : actual.recordAudit(...args)),
  };
});
afterEach(() => {
  audit.fail = false;
});

const POINT = { lat: 51.1282, lng: 71.4305 };
const addressOf = async (requestId: string) => db.request.findUniqueOrThrow({ where: { id: requestId }, select: { address: true, addressLat: true, addressLng: true } });
const audits = (requestId: string) => db.auditEvent.count({ where: { action: "request.address.set", entityId: requestId } });
const codeOf = (p: Promise<unknown>) => p.then(() => "OK", (e: unknown) => (e as { code?: string }).code ?? "ERROR");

describe("setDealAddress — адрес сделки (ADR-016)", () => {
  it("покупатель сохраняет адрес с точкой: заявка сделки получает адрес, журнал — запись в истории сделки", async () => {
    const f = await makeDeal({ address: null });
    await setDealAddress(f.client, f.dealId, { address: "ул. Достык, 5, кв. 12", location: POINT });
    expect(await addressOf(f.requestId)).toEqual({ address: "ул. Достык, 5, кв. 12", addressLat: POINT.lat, addressLng: POINT.lng });
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "request.address.set", entityId: f.requestId } });
    expect(event).toMatchObject({ scope: `deal:${f.dealId}`, entityType: "request", actorId: f.client.id });
    expect(await getDealAddress(f.client, f.dealId)).toEqual({ address: "ул. Достык, 5, кв. 12", location: POINT });
  });

  it("повтор с тем же адресом ничего не пишет; новый адрес без точки стирает прежнюю точку", async () => {
    const f = await makeDeal({ address: null });
    const input = { address: "ул. Абая, 1", location: POINT };
    await setDealAddress(f.client, f.dealId, input);
    await setDealAddress(f.client, f.dealId, input);
    expect(await audits(f.requestId)).toBe(1);

    await setDealAddress(f.client, f.dealId, { address: "ул. Абая, 2", location: null });
    expect(await addressOf(f.requestId)).toEqual({ address: "ул. Абая, 2", addressLat: null, addressLng: null });
    expect(await audits(f.requestId)).toBe(2);
  });

  it("чужой покупатель — NOT_FOUND, мастер сделки — FORBIDDEN; адрес не записан", async () => {
    const f = await makeDeal({ address: null });
    const stranger = await makeClient();
    expect(await codeOf(setDealAddress(stranger, f.dealId, { address: "ул. Чужая, 1", location: null }))).toBe("NOT_FOUND");
    expect(await codeOf(setDealAddress(f.executor, f.dealId, { address: "ул. Мастера, 1", location: null }))).toBe("FORBIDDEN");
    expect(await codeOf(getDealAddress(stranger, f.dealId))).toBe("NOT_FOUND");
    expect(await codeOf(getDealAddress(f.executor, f.dealId))).toBe("FORBIDDEN");
    expect(await codeOf(setDealAddress(f.client, "нет-такой-сделки", { address: "ул. Абая, 1", location: null }))).toBe("NOT_FOUND");
    expect((await addressOf(f.requestId)).address).toBeNull();
    expect(await audits(f.requestId)).toBe(0);
  });

  it("оконченная сделка (отменена, деньги возвращены) — CONFLICT, адрес не меняется", async () => {
    const created = await makeDeal({ address: null });
    await cancelDeal(created.client, { dealId: created.dealId, reason: "Передумали" });
    expect(await codeOf(setDealAddress(created.client, created.dealId, { address: "ул. Абая, 1", location: null }))).toBe("CONFLICT");

    const paid = await dealAt("PAID_HOLD", { address: null });
    await setDealAddress(paid.client, paid.dealId, { address: "ул. Абая, 1", location: null });
    await cancelDeal(paid.client, { dealId: paid.dealId });
    expect((await db.deal.findUniqueOrThrow({ where: { id: paid.dealId } })).status).toBe("REFUNDED");
    expect(await codeOf(setDealAddress(paid.client, paid.dealId, { address: "ул. Абая, 2", location: null }))).toBe("CONFLICT");
    expect((await addressOf(paid.requestId)).address).toBe("ул. Абая, 1");
    // Прочитать адрес оконченной сделки можно.
    expect((await getDealAddress(paid.client, paid.dealId)).address).toBe("ул. Абая, 1");
  });

  it("идущая сделка после оферты — адрес меняется", async () => {
    const f = await dealAt("IN_PROGRESS", { address: null });
    await setDealAddress(f.client, f.dealId, { address: "ул. Кенесары, 40", location: null });
    expect((await addressOf(f.requestId)).address).toBe("ул. Кенесары, 40");
  });

  it("неверный адрес или точка — VALIDATION, ничего не записано", async () => {
    const f = await makeDeal({ address: null });
    expect(await codeOf(setDealAddress(f.client, f.dealId, { address: "  ул ", location: null }))).toBe("VALIDATION");
    expect(await codeOf(setDealAddress(f.client, f.dealId, { address: "у".repeat(201), location: null }))).toBe("VALIDATION");
    expect(await codeOf(setDealAddress(f.client, f.dealId, { address: "ул. Абая, 1", location: { lat: 91, lng: 71 } }))).toBe("VALIDATION");
    expect((await addressOf(f.requestId)).address).toBeNull();
  });

  it("журнал не записался — адрес тоже не записан (одна транзакция)", async () => {
    const f = await makeDeal({ address: null });
    audit.fail = true;
    await expect(setDealAddress(f.client, f.dealId, { address: "ул. Абая, 1", location: POINT })).rejects.toThrow("журнал недоступен");
    expect(await addressOf(f.requestId)).toEqual({ address: null, addressLat: null, addressLng: null });
  });
});
