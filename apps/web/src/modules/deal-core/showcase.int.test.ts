import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DealStatus } from "@/generated/prisma/enums";
import { listCatalog } from "@/modules/companies";
import { db, transaction } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { makeDealWithReport, makePortfolioItem } from "../../../test/factories/companies";
import { dealAt, type DealFixture } from "../../../test/factories/deal";
import { closeShowcasesOf, getDealShowcase, setDealShowcase, SHOWCASE_TEXT_VERSION } from "./index";

/** Сделка с офертой, доведённая до нужного конечного статуса напрямую в базе (путь к статусу не важен для выбора). */
async function endedAt(status: DealStatus = "SPLIT_PAYOUT"): Promise<DealFixture> {
  const f = await dealAt("SIGNED");
  await db.deal.update({ where: { id: f.dealId }, data: { status } });
  return f;
}

const CLOSED = { photos: false, price: false, address: "NONE", signature: "INITIAL" } as const;
const open = (dealId: string) => ({ dealId, photos: true, price: true, address: "CITY", signature: "NAME" }) as const;
const showcaseAudit = (dealId: string) => db.auditEvent.findMany({ where: { entityId: dealId, action: "deal.showcase.changed" }, orderBy: { seq: "asc" } });

/** Перенос прежнего согласия — тот же INSERT, что в миграции (база тестов уже мигрирована, переносить нечего). */
function migrationInsert(): string {
  const sql = readFileSync(path.resolve("prisma/migrations/20261118100000_deal_showcase/migration.sql"), "utf8");
  const insert = /INSERT INTO "DealShowcase"[\s\S]*?;/.exec(sql)?.[0];
  if (!insert) throw new Error("в миграции нет переноса согласий");
  return insert;
}

describe("выбор покупателя: что из сделки видно в профиле мастера", () => {
  it("работа из сделки видна в каталоге только при showcase.photos (прежнее согласие перенесено миграцией)", async () => {
    const d = await makeDealWithReport();
    await db.user.update({ where: { id: d.client.id }, data: { fullName: "Сапарова Айгерим Маратовна" } });
    const item = await makePortfolioItem(d.executor, { title: "Кухня из сделки" });
    await db.portfolioItem.update({ where: { id: item.id }, data: { dealId: d.dealId } });
    const visible = async () => (await listCatalog({ page: 1 })).items.some((i) => i.id === item.id);
    expect(await visible()).toBe(false);

    // Прежнее согласие осталось только в колонке: каталог его больше не читает.
    await db.deal.update({ where: { id: d.dealId }, data: { portfolioConsentAt: new Date() } });
    expect(await visible()).toBe(false);
    const other = await makeDealWithReport();
    await db.$executeRawUnsafe(migrationInsert());
    expect(await visible()).toBe(true);
    const row = await db.dealShowcase.findUniqueOrThrow({ where: { dealId: d.dealId } });
    expect(row).toMatchObject({ ...CLOSED, photos: true, signedAs: "А.", textVersion: "2026-11-18", updatedById: d.client.id });
    expect(await db.dealShowcase.count({ where: { dealId: other.dealId } })).toBe(0);
    // Повтор миграции ничего не меняет.
    await db.$executeRawUnsafe(migrationInsert());
    expect(await db.dealShowcase.count()).toBe(1);

    await transaction((tx) => closeShowcasesOf(tx, d.client.id));
    expect(await visible()).toBe(false);
  });

  it("перенос: подпись — инициал имени (второе слово), одно слово — его инициал, без ФИО — пусто", async () => {
    const cases = [
      { fullName: "Сапарова Айгерим Маратовна", signedAs: "А." },
      { fullName: "Айгерим", signedAs: "А." },
      { fullName: null, signedAs: "" },
    ];
    const deals = [];
    for (const c of cases) {
      const d = await makeDealWithReport();
      await db.user.update({ where: { id: d.client.id }, data: { fullName: c.fullName } });
      await db.deal.update({ where: { id: d.dealId }, data: { portfolioConsentAt: new Date() } });
      deals.push({ dealId: d.dealId, signedAs: c.signedAs });
    }
    await db.$executeRawUnsafe(migrationInsert());
    for (const d of deals) expect((await db.dealShowcase.findUniqueOrThrow({ where: { dealId: d.dealId } })).signedAs).toBe(d.signedAs);
  });

  it("покупатель оконченной сделки с офертой сохраняет выбор; аудит deal.showcase.changed с прежним и новым", async () => {
    for (const status of ["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"] as const) {
      const f = await endedAt(status);
      await setDealShowcase(f.client, open(f.dealId));
      expect(await getDealShowcase(f.client, f.dealId)).toMatchObject({ photos: true, price: true, address: "CITY", signature: "NAME", changeable: true });
      await setDealShowcase(f.client, { dealId: f.dealId, ...CLOSED });
      expect(await getDealShowcase(f.client, f.dealId)).toMatchObject({ ...CLOSED, changeable: true });

      const audit = await showcaseAudit(f.dealId);
      // Первый ответ: прежнего выбора не было (закрытый вид по умолчанию) — before пуст.
      expect(audit.map((a) => [a.before, a.after])).toEqual([
        [null, { photos: true, price: true, address: "CITY", signature: "NAME" }],
        [{ photos: true, price: true, address: "CITY", signature: "NAME" }, CLOSED],
      ]);
      expect(audit[0]).toMatchObject({ actorId: f.client.id, scope: `deal:${f.dealId}`, meta: { textVersion: SHOWCASE_TEXT_VERSION } });
      // Имя в журнал не попадает.
      const logged = JSON.stringify(audit.map((a) => [a.before, a.after, a.meta]));
      expect(logged).not.toContain("signedAs");
      // ФИО фабрики «Тест CLIENT n» — подпись «Client» / «C.».
      expect(logged).not.toMatch(/Client|C\./);
      expect(await db.dealShowcase.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ updatedById: f.client.id, textVersion: SHOWCASE_TEXT_VERSION });
    }
  });

  it("подпись — снимок имени: NAME → \"Айгерим\", INITIAL → \"А.\"", async () => {
    const f = await endedAt();
    await db.user.update({ where: { id: f.client.id }, data: { fullName: "Сапарова Айгерим Маратовна" } });
    await setDealShowcase(f.client, open(f.dealId));
    expect((await getDealShowcase(f.client, f.dealId)).signedAs).toBe("Айгерим");

    // Снимок: смена ФИО в проекции не меняет сохранённую подпись.
    await db.user.update({ where: { id: f.client.id }, data: { fullName: "Сапарова Әсел Маратовна" } });
    expect((await getDealShowcase(f.client, f.dealId)).signedAs).toBe("Айгерим");

    await setDealShowcase(f.client, { ...open(f.dealId), signature: "INITIAL" });
    expect(await getDealShowcase(f.client, f.dealId)).toMatchObject({ signature: "INITIAL", signedAs: "Ә." });

    const single = await endedAt();
    await db.user.update({ where: { id: single.client.id }, data: { fullName: "Айгерим" } });
    await setDealShowcase(single.client, open(single.dealId));
    expect((await getDealShowcase(single.client, single.dealId)).signedAs).toBe("Айгерим");

    // ФИО нет — подпись только инициалом, и та пустая: публичная страница отзыв не подписывает.
    const nameless = await endedAt();
    await db.user.update({ where: { id: nameless.client.id }, data: { fullName: null } });
    await setDealShowcase(nameless.client, open(nameless.dealId));
    expect(await getDealShowcase(nameless.client, nameless.dealId)).toMatchObject({ signature: "INITIAL", signedAs: "" });
  });

  it("мастер, оператор, чужой — FORBIDDEN/NOT_FOUND; идущая и до оферты — CONFLICT", async () => {
    const f = await endedAt();
    await expect(setDealShowcase(f.executor, open(f.dealId))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setDealShowcase(await makeOperator(), open(f.dealId))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stranger = await makeClient();
    await expect(setDealShowcase(stranger, open(f.dealId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDealShowcase(stranger, f.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setDealShowcase(f.client, open("нет-такой-сделки"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Стороны и оператор видят выбор, но поменять его может только покупатель.
    expect((await getDealShowcase(f.executor, f.dealId)).changeable).toBe(false);
    expect((await getDealShowcase(await makeOperator(), f.dealId)).changeable).toBe(false);

    const running = await dealAt("IN_PROGRESS");
    await expect(setDealShowcase(running.client, open(running.dealId))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getDealShowcase(running.client, running.dealId)).changeable).toBe(false);

    const unsigned = await endedAt("CANCELLED");
    await db.deal.update({ where: { id: unsigned.dealId }, data: { signedAt: null } });
    await expect(setDealShowcase(unsigned.client, open(unsigned.dealId))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getDealShowcase(unsigned.client, unsigned.dealId)).changeable).toBe(false);

    expect(await db.dealShowcase.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "deal.showcase.changed" } })).toBe(0);
  });

  it("COMPLEX без ЖК у заявки и DISTRICT без района — VALIDATION", async () => {
    const f = await endedAt();
    expect((await getDealShowcase(f.client, f.dealId)).addressOptions).toEqual(["NONE", "CITY"]);
    await expect(setDealShowcase(f.client, { ...open(f.dealId), address: "DISTRICT" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setDealShowcase(f.client, { ...open(f.dealId), address: "COMPLEX" })).rejects.toMatchObject({ code: "VALIDATION" });

    await db.request.update({ where: { id: f.requestId }, data: { district: "Есильский район" } });
    expect((await getDealShowcase(f.client, f.dealId)).addressOptions).toEqual(["NONE", "CITY", "DISTRICT"]);
    await expect(setDealShowcase(f.client, { ...open(f.dealId), address: "COMPLEX" })).rejects.toMatchObject({ code: "VALIDATION" });
    await setDealShowcase(f.client, { ...open(f.dealId), address: "DISTRICT" });

    // ЖК без района не показывается.
    await db.request.update({ where: { id: f.requestId }, data: { district: null, complex: "Хайвил" } });
    expect((await getDealShowcase(f.client, f.dealId)).addressOptions).toEqual(["NONE", "CITY"]);

    await db.request.update({ where: { id: f.requestId }, data: { district: "Есильский район", complex: "Хайвил" } });
    expect((await getDealShowcase(f.client, f.dealId)).addressOptions).toEqual(["NONE", "CITY", "DISTRICT", "COMPLEX"]);
    await setDealShowcase(f.client, { ...open(f.dealId), address: "COMPLEX" });
    expect((await getDealShowcase(f.client, f.dealId)).address).toBe("COMPLEX");

    // Лишнее поле и чужое значение — отказ схемы.
    await expect(setDealShowcase(f.client, { ...open(f.dealId), address: "STREET" } as never)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setDealShowcase(f.client, { ...open(f.dealId), street: "ул. Тестовая" } as never)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("повтор с тем же содержимым — одна запись аудита", async () => {
    const f = await endedAt();
    const clientKey = "8f0f6a39-58f3-4c0b-9d5e-2f43a1f0b6a1";
    await Promise.all([setDealShowcase(f.client, { ...open(f.dealId), clientKey }), setDealShowcase(f.client, { ...open(f.dealId), clientKey })]);
    await setDealShowcase(f.client, open(f.dealId));
    expect(await showcaseAudit(f.dealId)).toHaveLength(1);

    // Явный ответ «ничего не показывать» записывается (ответ с версией текста) один раз; повтор — без журнала.
    const g = await endedAt();
    expect((await getDealShowcase(g.client, g.dealId)).answered).toBe(false);
    await setDealShowcase(g.client, { dealId: g.dealId, ...CLOSED });
    await setDealShowcase(g.client, { dealId: g.dealId, ...CLOSED });
    expect(await getDealShowcase(g.client, g.dealId)).toMatchObject({ ...CLOSED, answered: true });
    expect((await showcaseAudit(g.dealId)).map((a) => [a.before, a.after])).toEqual([[null, CLOSED]]);
  });

  it("closeShowcasesOf: все выборы человека — закрытый вид, подпись — инициал", async () => {
    const client = await makeClient("Сапарова Айгерим Маратовна");
    const first = await endedAt();
    const second = await endedAt("REFUNDED");
    for (const f of [first, second]) await db.deal.update({ where: { id: f.dealId }, data: { clientId: client.id } });
    await db.request.updateMany({ where: { id: { in: [first.requestId, second.requestId] } }, data: { clientId: client.id, district: "Есильский район" } });
    await setDealShowcase(client, { ...open(first.dealId), address: "DISTRICT" });
    await setDealShowcase(client, { ...open(second.dealId), signature: "INITIAL" });
    const someoneElse = await endedAt();
    await setDealShowcase(someoneElse.client, open(someoneElse.dealId));

    expect(await transaction((tx) => closeShowcasesOf(tx, client.id))).toBe(2);
    for (const f of [first, second]) {
      expect(await getDealShowcase(client, f.dealId)).toMatchObject({ ...CLOSED, signedAs: "А.", changeable: true });
      const audit = await showcaseAudit(f.dealId);
      expect(audit.at(-1)).toMatchObject({ actorId: null, actorRole: "SYSTEM", after: CLOSED });
      expect(await db.dealShowcase.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ updatedById: "system:consent-revocation" });
    }
    expect(await getDealShowcase(someoneElse.client, someoneElse.dealId)).toMatchObject({ photos: true, signature: "NAME" });
    // Повтор ничего не закрывает и журнал не пишет.
    expect(await transaction((tx) => closeShowcasesOf(tx, client.id))).toBe(0);
    expect(await db.auditEvent.count({ where: { action: "deal.showcase.changed", entityId: { in: [first.dealId, second.dealId] } } })).toBe(4);
  });

  it("без строки — getDealShowcase отдаёт закрытый вид по умолчанию", async () => {
    const f = await endedAt();
    expect(await getDealShowcase(f.client, f.dealId)).toEqual({ ...CLOSED, signedAs: "", answered: false, changeable: true, addressOptions: ["NONE", "CITY"] });
    expect(await db.dealShowcase.count()).toBe(0);
  });
});
