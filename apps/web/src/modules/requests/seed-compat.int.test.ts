import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/demo/seed";
import { db } from "@/platform/db";
import { useSeedStorage } from "../../../test/factories/documents";
import { setEnv } from "../../../test/factories/identity";
import { requestDetailsSchema } from "./schema";
import { getClientRequest, getIncomingRequest, listIncomingRequests, listMyRequests, listOffers } from "./index";

/** Демо-данные сида читаются сервисом requests без поправок: формат details и состояния совпадают. */
let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useSeedStorage();
  // Сид оплачивает тестовые сделки без сессий сторон — только при DEMO_MODE (Ruling AD).
  setEnv({ DEMO_MODE: "true" });
});
afterAll(async () => {
  setEnv({ DEMO_MODE: undefined });
  await cleanup();
});

describe("совместимость с демо-данными", () => {
  it("каждая заявка сида проходит схему details, а экраны заказчика и исполнителя их читают", { timeout: 120_000 }, async () => {
    await seedDemo(db);

    const requests = await db.request.findMany({ include: { client: true } });
    for (const r of requests) {
      expect(requestDetailsSchema.safeParse(r.details).success, `заявка №${r.number}`).toBe(true);
    }

    const tender = requests.find((r) => r.status === "OPEN" && r.mode === "TENDER" && r.segment === "COMFORT")!;
    const client = { id: tender.clientId, role: "CLIENT" as const, roles: tender.client.roles, phone: tender.client.phone, fullName: null, iinLast4: null, isDemo: true, executor: null, mfa: { required: false, verifiedAt: null }, consents: [], consentRevocationOpen: false };
    expect((await listMyRequests(client)).length).toBeGreaterThan(0);
    await expect(getClientRequest(client, tender.id)).resolves.toMatchObject({ status: "OPEN" });
    expect((await listOffers(client, { requestId: tender.id, sort: "rating" })).length).toBeGreaterThan(0);

    // Исполнитель сида того же уровня, ещё не откликнувшийся на тендер (фабрики делят с сидом диапазон телефонов).
    const profile = await db.executorProfile.findFirstOrThrow({
      where: { status: "APPROVED", segment: "COMFORT", offers: { none: { requestId: tender.id } } },
      include: { user: true },
    });
    const executor = {
      id: profile.userId,
      role: "EXECUTOR" as const,
      roles: profile.user.roles,
      phone: profile.user.phone,
      fullName: null,
      iinLast4: null,
      isDemo: true,
      executor: { id: profile.id, publicNumber: profile.publicNumber, status: profile.status },
      mfa: { required: false, verifiedAt: null },
      consents: [],
      consentRevocationOpen: false,
    };
    expect((await listIncomingRequests(executor)).map((r) => r.id)).toContain(tender.id);
    await expect(getIncomingRequest(executor, tender.id)).resolves.toMatchObject({ address: null, canOffer: true });
  });
});
