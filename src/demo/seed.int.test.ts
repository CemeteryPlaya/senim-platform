import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RequestStatus } from "@/generated/prisma/enums";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { EXECUTORS } from "./data";
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

  it("не дают засеять непустую базу повторно, а resetDemo пересоздаёт её с теми же объёмами", async () => {
    const before = { users: await db.user.count(), deals: await db.deal.count(), audit: await db.auditEvent.count() };
    await expect(seedDemo(db)).rejects.toThrow(/не пуста/);
    await resetDemo(db);
    expect({ users: await db.user.count(), deals: await db.deal.count(), audit: await db.auditEvent.count() }).toEqual(before);
    expect((await db.request.findFirstOrThrow({ orderBy: { number: "asc" } })).number).toBe(1);
  });
});
