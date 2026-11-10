import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { computeDealMoney, computeSplit, moneyFacts, ledgerEntries } from "@/modules/payments";
import { segmentPriceHints } from "@/modules/requests";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { typicalEstimateSchema } from "@/verticals/furniture";
import { useSeedStorage } from "../../test/factories/documents";
import { setEnv } from "../../test/factories/identity";
import { identityFake } from "../../test/stubs/identity";
import { EXECUTORS, OPERATOR } from "./data";
import { PORTFOLIO_FILES } from "./portfolio-files";
import { resetDemo, seedDemo } from "./seed";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useSeedStorage();
});
afterAll(() => cleanup());

const sum = (rows: { type: string; status: string; amountTiyn: bigint }[], type: string) =>
  rows.filter((r) => r.type === type && r.status === "SUCCEEDED").reduce((a, r) => a + r.amountTiyn, 0n);

// Сид дорогой (сделки идут сервисами, документы — PDF): одна засевка на тест, проверки сгруппированы.
describe("демо-данные", () => {
  it("заявки и торг: все статусы заявок; путь ТЗ — без сценария до договора, у живого отклика открытая цена", { timeout: 120_000 }, async () => {
    await seedDemo(db);

    const groups = await db.request.groupBy({ by: ["status"], _count: true });
    expect(groups.map((g) => g.status).sort()).toEqual(Object.values(RequestStatus).sort());

    const tz = await db.request.findMany({ where: { preContractFlow: null, status: { not: "DRAFT" } }, include: { offers: { include: { proposals: true, deal: true } } } });
    expect(tz.length).toBeGreaterThan(10);
    for (const r of tz) {
      for (const o of r.offers.filter((o) => o.status === "SENT" || o.status === "ACCEPTED")) {
        const open = o.proposals.filter((p) => p.status === "PROPOSED");
        const accepted = o.proposals.filter((p) => p.status === "ACCEPTED");
        expect(open.length + accepted.length, `заявка №${r.number}`).toBe(1);
        if (accepted.length) expect(o.deal?.priceTiyn).toBe(accepted[0]!.amountTiyn);
      }
    }
    // Торг в разных раундах: встречная цена покупателя ждёт мастера, третий раунд ждёт покупателя.
    const parties = (await db.priceProposal.findMany({ where: { status: "PROPOSED" }, select: { party: true } })).map((p) => p.party);
    expect(new Set(parties)).toEqual(new Set(["CLIENT", "EXECUTOR"]));
    expect(await db.priceProposal.count({ where: { status: "SUPERSEDED" } })).toBeGreaterThan(3);

    const flows = await db.request.findMany({ where: { preContractFlow: { not: null } }, orderBy: { number: "asc" } });
    const others = await db.request.aggregate({ where: { preContractFlow: null }, _max: { number: true } });
    expect(flows[0]!.number).toBeGreaterThan(others._max.number!);
    const measurer = await db.user.findFirstOrThrow({ where: { roles: { has: "MEASURER" } }, include: { siteMeasurements: true } });
    expect(measurer).toMatchObject({ roles: ["MEASURER"], isDemo: true });
    expect(measurer.siteMeasurements).toHaveLength(1);
  });

  it("сделки: все статусы ТЗ на mock и manual, тестовые; журнал сходится с формулами до тиына", { timeout: 120_000 }, async () => {
    await seedDemo(db);
    const deals = await db.deal.findMany({ include: { transactions: true, disputes: true, documents: true, progressReports: true } });

    expect([...new Set(deals.map((d) => d.status))].sort()).toEqual(Object.values(DealStatus).sort());
    expect(new Set(deals.map((d) => d.paymentProvider))).toEqual(new Set(["MOCK", "MANUAL"]));
    expect(deals.every((d) => d.isDemo)).toBe(true);
    expect(deals.flatMap((d) => d.transactions).every((t) => t.isTest)).toBe(true);

    for (const d of deals) {
      const money = computeDealMoney(d.priceTiyn);
      expect({ buyer: d.buyerTotalTiyn, payout: d.payoutTiyn, income: d.platformIncomeTiyn }, `сделка №${d.number}`).toEqual({
        buyer: money.buyerTotalTiyn,
        payout: money.payoutTiyn,
        income: money.platformIncomeTiyn,
      });
      const t = d.transactions;
      const facts = moneyFacts(await ledgerEntries(db, d.id));
      expect(sum(t, "HOLD") - sum(t, "SPLIT_MASTER") - sum(t, "SPLIT_PLATFORM") - sum(t, "REFUND"), `остаток сделки №${d.number}`).toBe(facts.bankBalanceTiyn);
      const resolved = d.disputes.find((x) => x.status === "RESOLVED");
      if (d.status === "SPLIT_PAYOUT" && !resolved) {
        expect([sum(t, "HOLD"), sum(t, "SPLIT_MASTER"), sum(t, "SPLIT_PLATFORM"), sum(t, "REFUND")]).toEqual([money.buyerTotalTiyn, money.payoutTiyn, money.platformIncomeTiyn, 0n]);
      }
      if (d.status === "SPLIT_PAYOUT" && resolved) {
        const split = computeSplit(d.priceTiyn, resolved.masterShareTiyn!);
        expect([sum(t, "SPLIT_MASTER"), sum(t, "SPLIT_PLATFORM"), sum(t, "REFUND")]).toEqual([split.masterTiyn, split.platformTiyn, split.refundTiyn]);
        expect(split.refundTiyn).toBeGreaterThan(0n);
      }
      if (d.status === "REFUNDED") expect(sum(t, "REFUND")).toBe(money.buyerTotalTiyn);
      if (["SPLIT_PAYOUT", "REFUNDED"].includes(d.status)) expect(facts.bankBalanceTiyn).toBe(0n);
      // Оферта — настоящий PDF documents у каждой сделки; акт — у каждой сданной.
      expect(d.documents.some((doc) => doc.kind === "CONTRACT"), `оферта сделки №${d.number}`).toBe(true);
      if (d.readyAt) expect(d.documents.some((doc) => doc.kind === "ACCEPTANCE_ACT"), `акт сделки №${d.number}`).toBe(true);
    }
    const pdfFiles = await db.storedFile.findMany({ where: { document: { isNot: null } }, select: { provider: true, size: true } });
    expect(pdfFiles.every((f) => f.provider === "local" && f.size > 1000)).toBe(true);

    // manual: есть операции, ждущие оператора, и подтверждённые банковским документом (номер, дата, тестовый скан).
    const manual = deals.filter((d) => d.paymentProvider === "MANUAL").flatMap((d) => d.transactions);
    expect(manual.some((t) => t.status === "PENDING")).toBe(true);
    const confirmed = manual.filter((t) => t.status === "SUCCEEDED" && t.bankDocFileId);
    expect(confirmed.length).toBeGreaterThan(3);
    expect(confirmed.every((t) => t.bankDocNumber?.startsWith("ТЕСТ-") && t.bankDocDate)).toBe(true);
    expect(manual.filter((t) => t.status === "SUCCEEDED" && ["HOLD", "SPLIT_MASTER", "SPLIT_PLATFORM", "REFUND"].includes(t.type)).every((t) => t.bankDocFileId)).toBe(true);

    // Споры: открытые в PAID_HOLD и READY; решённые — раздел и полный возврат.
    const open = deals.filter((d) => d.disputes.some((x) => x.status === "OPEN"));
    expect(open.map((d) => d.status).sort()).toEqual(["PAID_HOLD", "READY"]);
    expect(open.every((d) => d.disputes[0]!.clientPosition && d.disputes[0]!.executorPosition)).toBe(true);
    expect(deals.flatMap((d) => d.disputes).filter((x) => x.status === "RESOLVED").map((x) => x.outcome).sort()).toEqual(["FULL_REFUND", "PARTIAL_SPLIT"]);

    // Сдача: одна в радиусе, одна вне; «Ход работ» с фото у сделки в работе.
    const ready = deals.filter((d) => d.status === "READY");
    expect(new Set(ready.map((d) => d.readyWithinRadius))).toEqual(new Set([true, false]));
    expect(deals.find((d) => d.status === "IN_PROGRESS")!.progressReports.length).toBeGreaterThanOrEqual(2);
    expect(await db.storedFile.count({ where: { purpose: "DELIVERY", dealId: { not: null } } })).toBeGreaterThan(5);

    // Уведомления сделок и денег — от сервисов.
    const kinds = new Set((await db.notification.findMany({ select: { kind: true } })).map((n) => n.kind));
    for (const kind of ["deal.offer.ready", "deal.ready", "deal.signed"]) expect(kinds.has(kind), kind).toBe(true);
    expect([...kinds].some((k) => k.startsWith("money."))).toBe(true);
  });

  it("люди: мастера с тестовыми адресами, KYC во всех статусах, БИН ТОО зашифрован; справочник цен — демо", { timeout: 120_000 }, async () => {
    await seedDemo(db);
    const spec = EXECUTORS.agash;
    const profile = await db.executorProfile.findFirstOrThrow({ where: { legalName: spec.legalName }, include: { user: true } });
    expect(profile.legalForm).toBe("TOO");
    expect(JSON.stringify(profile)).not.toContain(spec.bin);
    expect(decryptPii(profile.binIinEnc)).toBe(spec.bin);
    expect(profile.binIinLast4).toBe(spec.bin.slice(-4));

    const profiles = await db.executorProfile.findMany({ select: { district: true, streetAddress: true, kycStatus: true, status: true, payoutIbanEnc: true, kycDocuments: { select: { purpose: true } } } });
    expect(profiles.length).toBe(Object.keys(EXECUTORS).length);
    for (const p of profiles) {
      expect(p.district).not.toBe("");
      expect(p.streetAddress).toMatch(/\(демо\)$/);
      if (p.status === "APPROVED") expect(decryptPii(p.payoutIbanEnc!)).toMatch(/^KZ\d{2}000DEMO/);
    }
    expect(new Set(profiles.filter((p) => p.kycDocuments.length > 0).map((p) => p.kycStatus))).toEqual(new Set(["VERIFIED", "PENDING", "REJECTED"]));
    expect(await db.user.count({ where: { role: "OPERATOR", isDemo: true } })).toBe(1);

    for (const [name, meta] of Object.entries(PORTFOLIO_FILES)) {
      const bytes = readFileSync(path.resolve("public/demo/portfolio", `${name}.svg`));
      expect({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, name).toEqual(meta);
    }

    const prices = await db.materialPrice.findMany();
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p.isDemo && p.active && p.priceKzt > 0 && p.segments.length > 0)).toBe(true);
    const estimates = await db.typicalEstimate.findMany({ include: { furnitureType: { select: { slug: true } } } });
    expect(estimates.map((e) => e.furnitureType.slug).sort()).toEqual(["hallway", "kitchen", "wardrobe"]);
    for (const e of estimates) {
      expect(e.isDemo).toBe(true);
      const { productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit } = e;
      expect(typicalEstimateSchema.safeParse({ productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit }).success).toBe(true);
      // Вилка по справочнику — функция калькулятора материалов (флаг materialsCalculator).
      setEnv({ FEATURE_MATERIALS_CALCULATOR: "true" });
      const hints = await segmentPriceHints(e.furnitureTypeId).finally(() => setEnv({ FEATURE_MATERIALS_CALCULATOR: undefined }));
      for (const hint of Object.values(hints)) expect(hint).toMatchObject({ source: "materials", demo: true });
    }
  });

  it("не дают засеять непустую базу повторно, а resetDemo пересоздаёт её с теми же объёмами", { timeout: 240_000 }, async () => {
    await seedDemo(db);
    const before = { users: await db.user.count(), deals: await db.deal.count(), requests: await db.request.count(), money: await db.moneyTransaction.count() };
    await expect(seedDemo(db)).rejects.toThrow(/не пуста/);
    await resetDemo(db);
    expect({ users: await db.user.count(), deals: await db.deal.count(), requests: await db.request.count(), money: await db.moneyTransaction.count() }).toEqual(before);
    expect((await db.request.findFirstOrThrow({ orderBy: { number: "asc" } })).number).toBe(1);
  });

  it("пользователи — из identity (SeedUsers): те же id в старой базе, дата регистрации из сида; resetDemo зовёт ResetDemo один раз и сохраняет id", { timeout: 240_000 }, async () => {
    const started = Date.now();
    await seedDemo(db);

    const seedCalls = identityFake.calls.filter((c) => c.method === "seedUsers");
    expect(seedCalls).toHaveLength(1);
    const sent = (seedCalls[0]!.request as { users: { phone: string; isDemo: boolean; createdAt?: unknown }[] }).users;
    const users = await db.user.findMany({ select: { id: true, phone: true, isDemo: true, createdAt: true } });
    expect(users.map((u) => u.phone).sort()).toEqual(sent.map((u) => u.phone).sort());
    for (const u of users) expect(identityFake.hasUser(u.id), `пользователь ${u.id} есть в identity`).toBe(true);
    expect(sent.every((u) => u.createdAt !== undefined)).toBe(true);
    expect(sent.filter((u) => !u.isDemo).length).toBeGreaterThan(0); // заказчики прошлых сделок — тоже в identity
    const operator = users.find((u) => u.phone === OPERATOR.phone)!;
    expect(Math.abs(operator.createdAt.getTime() - (started - OPERATOR.joinedDaysAgo * 86_400_000))).toBeLessThan(60_000);
    expect(identityFake.calls.filter((c) => c.method === "resetDemo")).toHaveLength(0);

    const ids = Object.fromEntries(users.map((u) => [u.phone, u.id]));
    identityFake.calls.length = 0;
    await resetDemo(db);
    expect(identityFake.calls.filter((c) => c.method === "resetDemo")).toHaveLength(1);
    expect(identityFake.calls.filter((c) => c.method === "seedUsers")).toHaveLength(1);
    const again = await db.user.findMany({ select: { id: true, phone: true } });
    expect(Object.fromEntries(again.map((u) => [u.phone, u.id]))).toEqual(ids);
  });

  it("без identity сид падает с подсказкой запустить стенд и не пишет старую базу", async () => {
    identityFake.failNextUnavailable();
    await expect(seedDemo(db)).rejects.toThrow(/npm run v2:up/);
    expect(await db.user.count()).toBe(0);

    identityFake.failNextUnavailable();
    await expect(resetDemo(db)).rejects.toThrow(/npm run v2:up/);
  });
});
