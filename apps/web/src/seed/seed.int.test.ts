import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/gen/senim/identity/v1/identity_pb";
import { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { computeDealMoney, computeSplit, moneyFacts, ledgerEntries } from "@/modules/payments";
import { segmentPriceHints } from "@/modules/requests";
import { ConsentKind, KycStatus as ProtoKycStatus } from "@/gen/senim/identity/v1/identity_pb";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import { db } from "@/platform/db";
import { typicalEstimateSchema } from "@/verticals/furniture";
import { useSeedStorage } from "../../test/factories/documents";
import { setEnv } from "../../test/factories/identity";
import { identityFake } from "../../test/stubs/identity";
import { monthOf } from "@/modules/deal-core";
import { totpNow } from "../../e2e/totp";
import { CLIENTS, DEALS, EXECUTORS, KYC, MEASURER, OPERATOR, OPERATOR_TOTP_SECRET, REVIEWS } from "./data";
import { seedFile } from "./portfolio-files";
import { reseedStand, seedStand } from "./seed";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useSeedStorage();
});
afterAll(async () => {
  await cleanup();
});

/**
 * Почта сида: у каждого покупателя и мастера сида — `<ключ>@example.com`, подтверждённая в identity и в проекции
 * (шаг почты на стенде не нужен); у сотрудников адреса нет. Проекция совпадает с identity у всех людей сида.
 */
async function expectSeedEmails(): Promise<void> {
  const people: [string, string | null][] = [
    ...Object.entries(CLIENTS).map(([key, p]): [string, string | null] => [p.phone, `${key}@example.com`]),
    ...Object.entries(EXECUTORS).map(([key, e]): [string, string | null] => [e.person.phone, `${key}@example.com`]),
    [OPERATOR.phone, null],
    [MEASURER.phone, null],
  ];
  for (const [phone, email] of people) {
    const row = await db.user.findUniqueOrThrow({ where: { phone }, select: { id: true, email: true, emailVerifiedAt: true } });
    const person = identityFake.personOf(row.id);
    expect({ phone, email: row.email, verified: row.emailVerifiedAt !== null }).toEqual({ phone, email, verified: email !== null });
    expect({ phone, email: person.email || null, verified: person.emailVerified }).toEqual({ phone, email, verified: email !== null });
  }
}

const sum = (rows: { type: string; status: string; amountTiyn: bigint }[], type: string) =>
  rows.filter((r) => r.type === type && r.status === "SUCCEEDED").reduce((a, r) => a + r.amountTiyn, 0n);

// Сид дорогой (сделки идут сервисами, документы — PDF): одна засевка на тест, проверки сгруппированы.
describe("данные стенда", () => {
  it("заявки и торг: все статусы заявок; путь ТЗ — без сценария до договора, у живого отклика открытая цена", { timeout: 120_000 }, async () => {
    await seedStand(db);

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
    expect(measurer).toMatchObject({ roles: ["MEASURER"] });
    expect(measurer.siteMeasurements).toHaveLength(1);
  });

  it("сделки: все статусы ТЗ на mock и manual; тестовые операции — только мока; журнал сходится с формулами до тиына", { timeout: 120_000 }, async () => {
    await seedStand(db);
    const deals = await db.deal.findMany({ include: { transactions: true, disputes: true, documents: true, progressReports: true } });

    expect([...new Set(deals.map((d) => d.status))].sort()).toEqual(Object.values(DealStatus).sort());
    expect(new Set(deals.map((d) => d.paymentProvider))).toEqual(new Set(["MOCK", "MANUAL"]));
    // isTest — только по провайдеру: операции мока тестовые, операции manual — как боевые (оператор по документам).
    for (const d of deals) expect(d.transactions.every((t) => t.isTest === (d.paymentProvider === "MOCK")), `сделка №${d.number}`).toBe(true);

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

  it("время и витрина: действия сделок по дням, номера операций банка, отзывы и числа у мастеров; журналы снова только-добавление", { timeout: 180_000 }, async () => {
    const started = Date.now();
    await seedStand(db);
    const DAY = 86_400_000;

    // Ни одного события сделки и операции журнала «минутой засева»: всё перенесено на дни плана.
    expect(await db.auditEvent.count({ where: { scope: { startsWith: "deal:" }, createdAt: { gte: new Date(started) } } })).toBe(0);
    expect(await db.moneyTransaction.count({ where: { createdAt: { gte: new Date(started) } } })).toBe(0);
    const kitchen = await db.deal.findFirstOrThrow({ where: { status: "IN_PROGRESS" }, include: { progressReports: { orderBy: { createdAt: "asc" } } } });
    expect(Math.abs(kitchen.paidAt!.getTime() - (started - 20 * DAY))).toBeLessThan(DAY);
    expect(kitchen.progressReports[1]!.createdAt.getTime() - kitchen.progressReports[0]!.createdAt.getTime()).toBeGreaterThan(5 * DAY);
    const days = await db.auditEvent.findMany({ where: { scope: `deal:${kitchen.id}` }, select: { createdAt: true, seq: true }, orderBy: { seq: "asc" } });
    expect(new Set(days.map((e) => e.createdAt.toISOString().slice(0, 10))).size).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < days.length; i++) expect(days[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(days[i - 1]!.createdAt.getTime());

    // Номер операции у тестового провайдера — 12 цифр, без «MOCK-».
    const mock = await db.moneyTransaction.findMany({ where: { provider: "MOCK", status: "SUCCEEDED" }, select: { type: true, externalRef: true } });
    expect(mock.length).toBeGreaterThan(5);
    // FREEZE/UNFREEZE — отметки журнала без операции в банке, номера у них нет.
    expect(mock.filter((t) => !["FREEZE", "UNFREEZE"].includes(t.type) && !/^\d{12}$/.test(t.externalRef ?? ""))).toEqual([]);
    expect(await db.moneyTransaction.count({ where: { externalRef: { startsWith: "MOCK-" } } })).toBe(0);

    // Журналы аудита и денег после переноса — снова только-добавление.
    const anyEvent = await db.auditEvent.findFirstOrThrow();
    await expect(db.auditEvent.update({ where: { id: anyEvent.id }, data: { action: "x" } })).rejects.toThrow();
    const settled = await db.moneyTransaction.findFirstOrThrow({ where: { status: "SUCCEEDED" } });
    await expect(db.moneyTransaction.update({ where: { id: settled.id }, data: { externalRef: "x" } })).rejects.toThrow();

    // Витрина: отзывы по плану, рейтинг и завершённые сделки в профиле; у Ерлана выплата в текущем месяце.
    expect(await db.review.count()).toBe(REVIEWS.length);
    const profile = (phone: string) => db.executorProfile.findFirstOrThrow({ where: { user: { phone } } });
    for (const key of ["erlan", "qazaq", "dala", "timur", "asel"] as const) {
      const p = await profile(EXECUTORS[key].person.phone);
      expect({ key, reviews: p.reviewsCount > 0, deals: p.completedDeals > 0, rating: p.ratingAvg >= 4 }).toEqual({ key, reviews: true, deals: true, rating: true });
    }
    const erlan = await profile(EXECUTORS.erlan.person.phone);
    const payouts = await db.moneyTransaction.findMany({ where: { type: "SPLIT_MASTER", status: "SUCCEEDED", deal: { executorId: erlan.id } }, select: { settledAt: true } });
    expect(payouts.some((t) => monthOf(t.settledAt!) === monthOf(new Date(started)))).toBe(true);

    // Заявки порядка «до оферты» не попадают во «Входящие» мастеров «Комфорта» (экран такой заявки — в v1).
    expect(await db.request.count({ where: { status: "OPEN", mode: "TENDER", segment: "COMFORT", preContractFlow: { not: null } } })).toBe(0);
  });

  it("люди: мастера с тестовыми адресами, KYC во всех статусах, номера — только в identity; справочник цен", { timeout: 120_000 }, async () => {
    await seedStand(db);
    const spec = EXECUTORS.agash;
    const profile = await db.executorProfile.findFirstOrThrow({ where: { legalName: spec.legalName }, include: { user: true } });
    expect(profile.legalForm).toBe("TOO");
    expect(JSON.stringify(profile)).not.toContain(spec.bin);
    expect(profile.binIinLast4).toBe(spec.bin.slice(-4));
    expect(identityFake.partyNumbersOf(profile.userId)?.binIin).toBe(spec.bin);

    const profiles = await db.executorProfile.findMany({
      select: { userId: true, district: true, streetAddress: true, kycStatus: true, status: true, payoutIbanLast4: true, kycDocuments: { select: { id: true, purpose: true } } },
    });
    expect(profiles.length).toBe(Object.keys(EXECUTORS).length);
    for (const p of profiles) {
      expect(p.district).not.toBe("");
      expect(p.streetAddress).toMatch(/^ул\. Тестовая, \d+$/);
      const iban = identityFake.partyNumbersOf(p.userId)?.payoutIban ?? "";
      if (p.status === "APPROVED") expect(iban).toMatch(/^KZ\d{2}000DEMO/);
      expect(p.payoutIbanLast4).toBe(iban === "" ? null : iban.slice(-4));
      // KYC в identity — с теми же файлами, что в старой базе: очередь /operator/kyc читает их из identity.
      const party = identityFake.partyOf(p.userId)!;
      expect(party.kycIdFileIds).toEqual(p.kycDocuments.filter((d) => d.purpose === "KYC_ID").map((d) => d.id));
      expect(party.kycRegistrationFileIds).toEqual(p.kycDocuments.filter((d) => d.purpose === "KYC_REGISTRATION").map((d) => d.id));
    }
    expect(new Set(profiles.filter((p) => p.kycDocuments.length > 0).map((p) => p.kycStatus))).toEqual(new Set(["VERIFIED", "PENDING", "REJECTED"]));
    const timur = identityFake.partyOf(profiles.find((p) => p.kycStatus === "REJECTED")!.userId)!;
    expect(timur).toMatchObject({ kycStatus: ProtoKycStatus.REJECTED, kycRejectReason: KYC.timur?.status === "REJECTED" ? KYC.timur.reason : "" });
    // Старая база — только проекции: ни шифртекстов, ни HMAC ИИН/БИН и IBAN.
    expect(await db.executorProfile.count({ where: { OR: [{ binIinEnc: { not: null } }, { binIinHash: { not: null } }, { signerIinEnc: { not: null } }, { payoutIbanEnc: { not: null } }] } })).toBe(0);
    expect(await db.user.count({ where: { OR: [{ iinEnc: { not: null } }, { iinHash: { not: null } }] } })).toBe(0);
    const aigerim = await db.user.findUniqueOrThrow({ where: { phone: CLIENTS.aigerim.phone } });
    expect(aigerim).toMatchObject({ fullName: CLIENTS.aigerim.fullName, iinLast4: CLIENTS.aigerim.iin.slice(-4), email: "aigerim@example.com" });
    expect(identityFake.personOf(aigerim.id)).toMatchObject({ fullName: CLIENTS.aigerim.fullName, iinLast4: CLIENTS.aigerim.iin.slice(-4), email: "aigerim@example.com", emailVerified: true });
    await expectSeedEmails();
    expect(await db.user.count({ where: { role: "OPERATOR" } })).toBe(1);

    // Фото сида — временные снимки из public/stand-photos. Публичное портфолио — хранилище static (адрес /stand-photos/…):
    // StoredFile сида совпадает с файлом на диске, у каждого файла свой ключ.
    const stored = await db.storedFile.findMany({ where: { provider: "static" } });
    for (const f of stored) {
      expect(f.storageKey).toMatch(/^stand-photos\/[a-z0-9-]+\.webp$/);
      expect(f.contentType).toBe("image/webp");
      const bytes = readFileSync(path.resolve("public", f.storageKey));
      expect({ size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, f.storageKey).toEqual({ size: f.size, sha256: f.sha256 });
    }
    expect(new Set(stored.map((f) => f.storageKey)).size).toBe(stored.length);
    expect(stored.map((f) => f.purpose)).toEqual(Array<string>(20).fill("PORTFOLIO"));
    expect(seedFile("kitchen-sage")).toMatchObject({ provider: "static", contentType: "image/webp" });
    // Фото «Хода работ» и сдачи — приватные файлы сделки: сид загружает байты через files (обычное хранилище,
    // только подписанная ссылка), а не кладёт публичный static-адрес. Число — по плану сделок сида.
    const steps = DEALS.flatMap((d) => d.steps);
    const progressPhotos = steps.reduce((n, s) => n + (typeof s === "object" && "progress" in s ? s.progress.photos.length : 0), 0);
    const readyPhotos = steps.reduce((n, s) => n + (typeof s === "object" && "ready" in s ? s.ready.photos.length : 0), 0);
    const privatePhotos = await db.storedFile.findMany({ where: { purpose: { in: ["PROGRESS_REPORT", "DELIVERY"] } } });
    expect(privatePhotos.length).toBeGreaterThan(0);
    for (const f of privatePhotos) {
      expect({ provider: f.provider, key: f.storageKey.startsWith("stand-photos/"), image: f.contentType.startsWith("image/") }, f.id).toEqual({ provider: expect.not.stringMatching(/^static$/), key: false, image: true });
    }
    expect(privatePhotos.filter((f) => f.purpose === "PROGRESS_REPORT" && f.progressReportId !== null)).toHaveLength(progressPhotos);
    expect(privatePhotos.filter((f) => f.purpose === "DELIVERY" && f.dealId !== null)).toHaveLength(readyPhotos);

    const prices = await db.materialPrice.findMany();
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p.active && p.priceKzt > 0 && p.segments.length > 0)).toBe(true);
    const estimates = await db.typicalEstimate.findMany({ include: { furnitureType: { select: { slug: true } } } });
    expect(estimates.map((e) => e.furnitureType.slug).sort()).toEqual(["hallway", "kitchen", "wardrobe"]);
    for (const e of estimates) {
      const { productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit } = e;
      expect(typicalEstimateSchema.safeParse({ productUnit, typicalWidthCm, typicalHeightCm, markup, perUnit }).success).toBe(true);
      // Вилка по справочнику — функция калькулятора материалов (флаг materialsCalculator).
      setEnv({ FEATURE_MATERIALS_CALCULATOR: "true" });
      const hints = await segmentPriceHints(e.furnitureTypeId).finally(() => setEnv({ FEATURE_MATERIALS_CALCULATOR: undefined }));
      for (const hint of Object.values(hints)) expect(hint).toMatchObject({ source: "materials" });
    }
  });

  it("согласия: на ПДн текущей редакции у всех, кроме сотрудников; передача банку — у обеих сторон каждой оплаченной сделки", { timeout: 120_000 }, async () => {
    await seedStand(db);
    const pd = { version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };
    for (const u of await db.user.findMany({ select: { id: true, role: true } })) {
      const consents = identityFake.consentsOf(u.id).filter((c) => c.kind === ConsentKind.PD_PROCESSING);
      if (u.role === "OPERATOR" || u.role === "MEASURER") expect(consents, u.role).toHaveLength(0);
      else expect(consents.map((c) => ({ version: c.version, textSha256: c.textSha256, channel: c.channel }))).toEqual([{ ...pd, channel: "seed" }]);
    }
    const bank = { version: consentDocument("BANK_TRANSFER").version, textSha256: consentTextSha256("BANK_TRANSFER") };
    const paid = await db.deal.findMany({ where: { transactions: { some: { type: "HOLD" } } }, select: { id: true, clientId: true, executor: { select: { userId: true } } } });
    expect(paid.length).toBe(DEALS.filter((d) => d.steps.includes("pay")).length);
    for (const d of paid) {
      for (const userId of [d.clientId, d.executor.userId]) {
        expect(identityFake.consentsOf(userId).filter((c) => c.referenceId === d.id).map((c) => ({ version: c.version, textSha256: c.textSha256, channel: c.channel }))).toEqual([{ ...bank, channel: "seed" }]);
      }
    }
    expect(identityFake.calls.filter((c) => c.method === "seedConsents")).toHaveLength(1);
  });

  it("не дают засеять непустую базу повторно, а reseedStand пересоздаёт её с теми же объёмами", { timeout: 240_000 }, async () => {
    await seedStand(db);
    const before = { users: await db.user.count(), deals: await db.deal.count(), requests: await db.request.count(), money: await db.moneyTransaction.count() };
    await expect(seedStand(db)).rejects.toThrow(/не пуста/);
    await reseedStand(db);
    expect({ users: await db.user.count(), deals: await db.deal.count(), requests: await db.request.count(), money: await db.moneyTransaction.count() }).toEqual(before);
    expect((await db.request.findFirstOrThrow({ orderBy: { number: "asc" } })).number).toBe(1);
  });

  it("пользователи — из identity (SeedUsers): те же id в старой базе, дата регистрации из сида; reseedStand зовёт ResetStand один раз и сохраняет id", { timeout: 240_000 }, async () => {
    const started = Date.now();
    await seedStand(db);

    const seedCalls = identityFake.calls.filter((c) => c.method === "seedUsers");
    expect(seedCalls).toHaveLength(1);
    const sent = (seedCalls[0]!.request as { users: { phone: string; createdAt?: unknown; totpSecretBase32?: string }[] }).users;
    const users = await db.user.findMany({ select: { id: true, phone: true, createdAt: true } });
    expect(users.map((u) => u.phone).sort()).toEqual(sent.map((u) => u.phone).sort());
    for (const u of users) expect(identityFake.hasUser(u.id), `пользователь ${u.id} есть в identity`).toBe(true);
    expect(sent.every((u) => u.createdAt !== undefined)).toBe(true);
    expect(sent.some((u) => u.phone === CLIENTS.arman.phone)).toBe(true); // заказчики прошлых сделок — тоже в identity
    // Известный секрет TOTP — только у оператора стенда.
    expect(sent.filter((u) => u.totpSecretBase32).map((u) => u.phone)).toEqual([OPERATOR.phone]);
    const operator = users.find((u) => u.phone === OPERATOR.phone)!;
    expect(Math.abs(operator.createdAt.getTime() - (started - OPERATOR.joinedDaysAgo * 86_400_000))).toBeLessThan(60_000);
    expect(identityFake.calls.filter((c) => c.method === "resetStand")).toHaveLength(0);

    const ids = Object.fromEntries(users.map((u) => [u.phone, u.id]));
    identityFake.calls.length = 0;
    await reseedStand(db);
    expect(identityFake.calls.filter((c) => c.method === "resetStand")).toHaveLength(1);
    expect(identityFake.calls.filter((c) => c.method === "seedUsers")).toHaveLength(1);
    const again = await db.user.findMany({ select: { id: true, phone: true } });
    expect(Object.fromEntries(again.map((u) => [u.phone, u.id]))).toEqual(ids);
    // После пересева почта в проекции снова совпадает с identity: подтверждена у покупателей и мастеров.
    await expectSeedEmails();
  });

  it("оператор стенда входит как все: код с экрана (мок SMS), затем код из приложения по секрету сида", { timeout: 120_000 }, async () => {
    await seedStand(db);
    const sent = await identityFake.client.requestOtp({ phone: OPERATOR.phone, idempotencyKey: "seed-op-otp" });
    const token = `${"s".repeat(43)}`;
    const res = await identityFake.client.verifyOtp({ phone: OPERATOR.phone, code: sent.shownCode, sessionToken: token, idempotencyKey: "seed-op-verify" });
    expect(res.user?.defaultRole).toBe(Role.OPERATOR);
    expect(res.user?.seeded).toBe(true);
    expect(res.session).toMatchObject({ mfaRequired: true, mfaVerifiedAt: undefined });
    const verified = await identityFake.client.verifySecondFactor({ sessionToken: token, code: totpNow(OPERATOR_TOTP_SECRET), idempotencyKey: "seed-op-mfa" });
    expect(verified.session?.mfaVerifiedAt).toBeDefined();
  });

  it("при APP_ENV=prod у identity (stand_disabled) пересев отказывает до TRUNCATE: данные старой базы остаются", { timeout: 120_000 }, async () => {
    await seedStand(db);
    const users = await db.user.count();
    identityFake.standEnabled = false;
    await expect(reseedStand(db)).rejects.toThrow(/stand_disabled/);
    expect(await db.user.count()).toBe(users);
  });

  it("без identity сид падает с подсказкой запустить стенд и не пишет старую базу", async () => {
    identityFake.failNextUnavailable();
    await expect(seedStand(db)).rejects.toThrow(/npm run v2:up/);
    expect(await db.user.count()).toBe(0);

    identityFake.failNextUnavailable();
    await expect(reseedStand(db)).rejects.toThrow(/npm run v2:up/);
  });
});
