import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RequestStatus } from "@/generated/prisma/enums";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { segmentPriceHints } from "@/modules/requests";
import { typicalEstimateSchema } from "@/verticals/furniture";
import { DEAL_SHOWCASES, EXECUTORS } from "./data";
import { PORTFOLIO_FILES } from "./portfolio-files";
import { resetDemo, seedDemo } from "./seed";

describe("демо-данные", () => {
  beforeEach(async () => {
    await seedDemo(db);
  });

  it("содержат заявки во всех статусах", async () => {
    const groups = await db.request.groupBy({ by: ["status"], _count: true });
    expect(groups.map((g) => g.status).sort()).toEqual(Object.values(RequestStatus).sort());
  });

  it("сценарии до договора 2-5: по заявке на шаге, с которого их проходят; сеются последними; замерщик — демо-персона", async () => {
    const flows = await db.request.findMany({ where: { preContractFlow: { notIn: ["EXECUTOR_MEASURE"] } }, orderBy: { number: "asc" } });
    expect(Object.fromEntries(flows.map((r) => [r.preContractFlow, r.status]))).toEqual({
      PLATFORM_MEASURER: "PLATFORM_MEASURING",
      CONTRACT_FIRST: "OFFER_CHOSEN",
      MEASURE_DEPOSIT: "OFFER_CHOSEN",
      SELF_MEASURE: "OPEN",
    });
    const others = await db.request.aggregate({ where: { id: { notIn: flows.map((r) => r.id) } }, _max: { number: true } });
    expect(flows[0]!.number).toBeGreaterThan(others._max.number!);
    const measurer = await db.user.findFirstOrThrow({ where: { roles: { has: "MEASURER" } }, include: { siteMeasurements: true } });
    expect(measurer).toMatchObject({ roles: ["MEASURER"], isDemo: true });
    expect(measurer.siteMeasurements).toHaveLength(1);
  });

  it("проект после замера: у сделок — утверждён на сумму сделки", async () => {
    const deals = await db.deal.findMany({ where: { request: { preContractFlow: "EXECUTOR_MEASURE" } }, select: { offerId: true, totalAmount: true } });
    for (const deal of deals) {
      const project = await db.project.findFirstOrThrow({ where: { offerId: deal.offerId } });
      expect(project).toMatchObject({ status: "APPROVED", totalPrice: deal.totalAmount });
    }
  });

  it("у каждой сделки сумма этапов равна сумме сделки, оплата есть только у этапов с суммой", async () => {
    const deals = await db.deal.findMany({ include: { stages: { include: { payment: true } } } });
    expect(deals.length).toBeGreaterThan(0);
    for (const deal of deals) {
      expect(deal.stages.reduce((sum, s) => sum + s.amount, 0), deal.title).toBe(deal.totalAmount);
      for (const stage of deal.stages) {
        expect(stage.payment?.amount ?? 0, `${deal.title} / ${stage.title}`).toBe(stage.amount);
      }
    }
  });

  it("не хранит БИН исполнителя-ТОО открытым текстом", async () => {
    const spec = EXECUTORS.agash;
    const profile = await db.executorProfile.findFirstOrThrow({ where: { legalName: spec.legalName }, include: { user: true } });
    expect(profile.legalForm).toBe("TOO");
    expect(JSON.stringify(profile)).not.toContain(spec.bin);
    expect(decryptPii(profile.binIinEnc)).toBe(spec.bin);
    expect(profile.binIinLast4).toBe(spec.bin.slice(-4));
  });

  it("у каждого исполнителя есть тестовый адрес мастерской (№6)", async () => {
    const profiles = await db.executorProfile.findMany({ select: { district: true, streetAddress: true } });
    expect(profiles.length).toBe(Object.keys(EXECUTORS).length);
    for (const p of profiles) {
      expect(p.district).not.toBe("");
      expect(p.streetAddress).toMatch(/\(демо\)$/);
    }
  });

  it("содержат ровно один открытый спор со структурой позиций", async () => {
    const open = await db.dispute.findMany({ where: { status: "OPEN" }, include: { deal: true } });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: "QUALITY", clientPosition: expect.any(String), executorPosition: expect.any(String) });
    expect(open[0].deal.status).toBe("DISPUTE");
  });

  it("описывают фото портфолио размером и sha256 реальных файлов", async () => {
    for (const [name, meta] of Object.entries(PORTFOLIO_FILES)) {
      const bytes = readFileSync(path.resolve("public/demo/portfolio", `${name}.svg`));
      expect({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, name).toEqual(meta);
    }
  });

  it("витрина из сделок: итоговые фото — копии демо-SVG, согласие заказчика, одна работа уже во «Вдохновении»", async () => {
    for (const spec of DEAL_SHOWCASES) {
      for (const [i, source] of spec.photos.entries()) {
        const bytes = readFileSync(path.resolve("public/demo/deals", `${spec.request}-${i + 1}.svg`));
        expect({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, spec.request).toEqual(PORTFOLIO_FILES[source]);
      }
    }
    const deals = await db.deal.findMany({ where: { portfolioConsentAt: { not: null } }, include: { portfolioItem: { include: { dealPhotos: true } } } });
    expect(deals).toHaveLength(DEAL_SHOWCASES.length);
    expect(deals.filter((d) => d.portfolioItem).map((d) => d.portfolioItem!.dealPhotos.length)).toEqual([2]);
    expect(await db.portfolioItem.count({ where: { featured: true } })).toBeGreaterThanOrEqual(4);
  });

  it("справочник цен материалов и типовые расчёты — демо; по ним считается вилка всех уровней (ADR-007)", async () => {
    const prices = await db.materialPrice.findMany();
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p.isDemo && p.active && p.priceKzt > 0 && p.segments.length > 0)).toBe(true);
    const estimates = await db.typicalEstimate.findMany({ include: { furnitureType: { select: { slug: true } } } });
    expect(estimates.map((e) => e.furnitureType.slug).sort()).toEqual(["hallway", "kitchen", "wardrobe"]);
    for (const e of estimates) {
      expect(e.isDemo).toBe(true);
      const { productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit } = e;
      expect(typicalEstimateSchema.safeParse({ productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit }).success).toBe(true);
      const hints = await segmentPriceHints(e.furnitureTypeId);
      for (const hint of Object.values(hints)) expect(hint).toMatchObject({ source: "materials", demo: true });
    }
  });

  it("не дают засеять непустую базу повторно, а resetDemo пересоздаёт её с теми же объёмами", async () => {
    const before = { users: await db.user.count(), deals: await db.deal.count(), audit: await db.auditEvent.count() };
    await expect(seedDemo(db)).rejects.toThrow(/не пуста/);
    await resetDemo(db);
    expect({ users: await db.user.count(), deals: await db.deal.count(), audit: await db.auditEvent.count() }).toEqual(before);
    expect((await db.request.findFirstOrThrow({ orderBy: { number: "asc" } })).number).toBe(1);
  });
});
