import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeAdmin, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeFurnitureType } from "../../../test/factories/companies";
import { makeDeal } from "../../../test/factories/deal";
import { makeOffer, makeRequest } from "../../../test/factories/operator";
import { getRecord, listModels, listRecords, type RecordsQuery } from "./read";
import { ADMIN_MODELS } from "./schema.gen";

const HIDDEN_NAMES = ["iinEnc", "iinHash", "iinLast4", "binIinEnc", "binIinHash", "binIinLast4", "signerIinEnc", "signerIinHash", "payoutIbanEnc", "payoutIbanLast4"];

/**
 * Мастер, у которого скрытые поля (ИИН, БИН, IBAN) заполнены заметными значениями: ни одно из них не встречается
 * в видимых полях, так что найденное в ответе или поиске — утечка, а не совпадение с телефоном или id.
 */
async function executorWithSecrets() {
  const executor = await makeExecutor({ legalName: "ИП Секретов" });
  const tag = randomUUID().slice(0, 8);
  const secrets = {
    iinEnc: `ENC-IIN-${tag}`,
    iinHash: `HASH-IIN-${tag}`,
    iinLast4: "Щ1Щ2",
    binIinEnc: `ENC-BIN-${tag}`,
    binIinHash: `HASH-BIN-${tag}`,
    binIinLast4: "Ж3Ж4",
    signerIinEnc: `ENC-SIGNER-${tag}`,
    signerIinHash: `HASH-SIGNER-${tag}`,
    payoutIbanEnc: `ENC-IBAN-${tag}`,
    payoutIbanLast4: "Ы5Ы6",
  };
  await db.user.update({ where: { id: executor.id }, data: { iinEnc: secrets.iinEnc, iinHash: secrets.iinHash, iinLast4: secrets.iinLast4 } });
  await db.executorProfile.update({
    where: { id: executor.executor.id },
    data: {
      binIinEnc: secrets.binIinEnc,
      binIinHash: secrets.binIinHash,
      binIinLast4: secrets.binIinLast4,
      signerIinEnc: secrets.signerIinEnc,
      signerIinHash: secrets.signerIinHash,
      payoutIbanEnc: secrets.payoutIbanEnc,
      payoutIbanLast4: secrets.payoutIbanLast4,
    },
  });
  return { executor, secrets: Object.values(secrets) };
}

function expectNoSecrets(result: unknown, secrets: readonly string[]) {
  const json = JSON.stringify(result);
  for (const name of HIDDEN_NAMES) expect(json, name).not.toContain(`"${name}"`);
  for (const value of secrets) expect(json, value).not.toContain(value);
}

const withoutMfa = (user: CurrentUser): CurrentUser => ({ ...user, mfa: { required: true, verifiedAt: null } });

describe("админка: чтение — кто допущен", () => {
  const calls: Record<string, (u: CurrentUser) => Promise<unknown>> = {
    listModels: (u) => listModels(u),
    listRecords: (u) => listRecords(u, "FurnitureType", {}),
    getRecord: (u) => getRecord(u, "FurnitureType", "x"),
  };

  it.each(Object.keys(calls))("%s: оператор, покупатель и мастер — FORBIDDEN; администратор без второго фактора — MFA_REQUIRED", async (name) => {
    const call = calls[name];
    for (const user of [await makeOperator(), await makeClient(), await makeExecutor(), withoutMfa(await makeOperator())]) {
      await expect(call(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(call(withoutMfa(await makeAdmin()))).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
});

describe("админка: список моделей", () => {
  it("все модели базы с числом записей и признаком «только чтение»", async () => {
    const admin = await makeAdmin();
    await makeFurnitureType();
    const models = await listModels(admin);
    expect(models.map((m) => m.name)).toEqual(ADMIN_MODELS.map((m) => m.name));
    expect(models.find((m) => m.name === "FurnitureType")).toEqual({ name: "FurnitureType", count: 1, readonly: false });
    expect(models.find((m) => m.name === "User")).toEqual({ name: "User", count: 1, readonly: true });
    expect(models.find((m) => m.name === "MoneyTransaction")).toMatchObject({ count: 0, readonly: true });
  });
});

describe("админка: записи таблицы", () => {
  it("каждая модель открывается списком и карточкой (запрос к базе собирается), неизвестная — NOT_FOUND", async () => {
    const admin = await makeAdmin();
    for (const model of ADMIN_MODELS) {
      await expect(listRecords(admin, model.name, {}), model.name).resolves.toMatchObject({ page: 1, pageSize: 50 });
      if (model.idField) await expect(getRecord(admin, model.name, randomUUID()), model.name).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(listRecords(admin, "Nope", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listRecords(admin, "constructor", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("User: в строках и колонках нет имён и значений скрытых полей", async () => {
    const admin = await makeAdmin();
    const { executor, secrets } = await executorWithSecrets();
    const result = await listRecords(admin, "User", {});
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.id)).toContain(executor.id);
    expect(result.columns).toEqual(expect.arrayContaining(["id", "phone", "fullName", "createdAt"]));
    expectNoSecrets(result, secrets);
  });

  it("поиск — только по видимым полям: хеш и последние 4 символа скрытого поля ничего не находят, ФИО — находит", async () => {
    const admin = await makeAdmin();
    const { executor, secrets } = await executorWithSecrets();
    for (const q of secrets) {
      expect((await listRecords(admin, "User", { q })).total, q).toBe(0);
      expect((await listRecords(admin, "ExecutorProfile", { q })).total, q).toBe(0);
    }
    const found = await listRecords(admin, "User", { q: executor.fullName?.toUpperCase() ?? "" });
    expect(found.rows.map((r) => r.id)).toEqual([executor.id]);
    expect((await listRecords(admin, "ExecutorProfile", { q: "секретов" })).rows.map((r) => r.id)).toEqual([executor.executor.id]);
  });

  it("фильтр и переход по скрытому полю — VALIDATION без значения в тексте; по статусу и булеву — работают", async () => {
    const admin = await makeAdmin();
    const { secrets } = await executorWithSecrets();
    const hash = secrets[1];
    const queries: RecordsQuery[] = [{ filters: { iinHash: hash } }, { where: { field: "iinHash", value: hash } }, { filters: { iinLast4: "Щ1Щ2" } }];
    for (const query of queries) {
      const error = await listRecords(admin, "User", query).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "VALIDATION" });
      expect(JSON.stringify(error) + String(error)).not.toContain(hash);
    }
    // Не фильтруемое поле (строка), неизвестное поле, неверное значение перечисления — тот же отказ.
    const refused: Record<string, string>[] = [{ phone: "+7" }, { nope: "1" }, { status: "PAID" }, { addedByOperator: "да" }];
    for (const filters of refused) {
      await expect(listRecords(admin, "ExecutorProfile", { filters })).rejects.toMatchObject({ code: "VALIDATION", message: ru.app.admin.data.errors.filter });
    }

    const pending = await makeExecutor({ status: "PENDING" });
    const approved = await listRecords(admin, "ExecutorProfile", { filters: { status: "APPROVED" } });
    expect(approved.total).toBe(1);
    expect((await listRecords(admin, "ExecutorProfile", { filters: { status: "PENDING" } })).rows.map((r) => r.id)).toEqual([pending.executor.id]);

    await makeFurnitureType({ active: false });
    await makeFurnitureType({ active: true });
    expect((await listRecords(admin, "FurnitureType", { filters: { active: "false" } })).rows.map((r) => r.active)).toEqual([false]);
  });

  it("сортировка — новые сверху (createdAt desc), по 50 на страницу", async () => {
    const admin = await makeAdmin();
    const base = Date.now() - 100_000;
    await db.furnitureType.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({ slug: `t-${i}`, name: `Тип ${i}`, createdAt: new Date(base + i * 1000) })),
    });
    const first = await listRecords(admin, "FurnitureType", {});
    expect(first).toMatchObject({ total: 51, page: 1, pageSize: 50 });
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].name).toBe("Тип 50");
    const second = await listRecords(admin, "FurnitureType", { page: 2 });
    expect(second.rows.map((r) => r.name)).toEqual(["Тип 0"]);
    // Неверный номер страницы — первая страница.
    expect((await listRecords(admin, "FurnitureType", { page: 0 })).page).toBe(1);
  });
});

describe("админка: карточка и связи", () => {
  it("ExecutorProfile: нет скрытых полей ни в записи, ни в описании полей, ни через связь с пользователем", async () => {
    const admin = await makeAdmin();
    const { executor, secrets } = await executorWithSecrets();
    const card = await getRecord(admin, "ExecutorProfile", executor.executor.id);
    expectNoSecrets(card, secrets);
    expect(card.row).toMatchObject({ id: executor.executor.id, legalName: "ИП Секретов", status: "APPROVED" });
    expect(card.fields.find((f) => f.name === "about")).toEqual({ name: "about", type: "String", access: "editable", required: true });
    expect(card.fields.find((f) => f.name === "status")).toMatchObject({ access: "readonly", enumValues: ["PENDING", "APPROVED", "REJECTED"] });
    expect(card.fields.map((f) => f.name)).not.toContain("user");

    const user = card.relations.find((r) => r.name === "user");
    expect(user).toEqual({ name: "user", model: "User", kind: "one", targetId: executor.id });
    // Связанная запись открывается своей карточкой — со своими правилами.
    const userCard = await getRecord(admin, "User", executor.id);
    expectNoSecrets(userCard, secrets);
    expect(userCard.relations.find((r) => r.name === "executorProfile")).toEqual({ name: "executorProfile", model: "ExecutorProfile", kind: "one", targetId: executor.executor.id });
    expect(userCard.relations.find((r) => r.name === "sessions")).toEqual({ name: "sessions", model: "Session", kind: "many", count: 0, field: "userId" });
  });

  it("Deal: связь «один» — id покупателя, суммы BigInt — строкой цифр (тиыны)", async () => {
    const admin = await makeAdmin();
    // Точность за пределом 2^53 — в values.test.ts: цена сделки не выше MAX_PRICE_TIYN (10^11).
    const { dealId, client } = await makeDeal({ priceTiyn: 99_999_999_999n });
    const card = await getRecord(admin, "Deal", dealId);
    expect(card.relations.find((r) => r.name === "client")).toEqual({ name: "client", model: "User", kind: "one", targetId: client.id });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(card.row.priceTiyn).toBe("99999999999");
    expect(card.row.buyerTotalTiyn).toBe(deal.buyerTotalTiyn.toString());
    expect(card.row.payoutTiyn).toBe(deal.payoutTiyn.toString());
    expect(card.row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(card.fields.find((f) => f.name === "priceTiyn")).toMatchObject({ type: "BigInt", access: "readonly" });
    const rows = await listRecords(admin, "Deal", {});
    expect(rows.rows[0].priceTiyn).toBe("99999999999");
  });

  it("Request.offers: связь «много» — число и переход к отфильтрованному списку", async () => {
    const admin = await makeAdmin();
    const request = await makeRequest();
    const other = await makeRequest();
    const a = await makeOffer(request.id);
    const b = await makeOffer(request.id);
    await makeOffer(other.id);
    const card = await getRecord(admin, "Request", request.id);
    expect(card.relations.find((r) => r.name === "offers")).toEqual({ name: "offers", model: "Offer", kind: "many", count: 2, field: "requestId" });
    const offers = await listRecords(admin, "Offer", { where: { field: "requestId", value: request.id } });
    expect(offers.total).toBe(2);
    expect(new Set(offers.rows.map((r) => r.id))).toEqual(new Set([a.id, b.id]));
    // Переход — только по внешнему ключу: обычное поле — отказ.
    await expect(listRecords(admin, "Offer", { where: { field: "status", value: "SENT" } })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("«много ко многим»: специализации мастера — число и переход по обратной связи", async () => {
    const admin = await makeAdmin();
    const executor = await makeExecutor();
    const kitchen = await makeFurnitureType();
    await makeFurnitureType();
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { specializations: { connect: { id: kitchen.id } } } });
    const card = await getRecord(admin, "ExecutorProfile", executor.executor.id);
    expect(card.relations.find((r) => r.name === "specializations")).toEqual({ name: "specializations", model: "FurnitureType", kind: "many", count: 1, field: "executors" });
    const types = await listRecords(admin, "FurnitureType", { where: { field: "executors", value: executor.executor.id } });
    expect(types.rows.map((r) => r.id)).toEqual([kitchen.id]);
  });

  it("неизвестная модель, модель без ключа и нет записи — NOT_FOUND", async () => {
    const admin = await makeAdmin();
    await expect(getRecord(admin, "Nope", "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRecord(admin, "PortfolioDealPhoto", "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRecord(admin, "FurnitureType", "нет-такой")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getRecord(admin, "FurnitureType", "")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("админка: тексты уведомлений (Раунд 1)", () => {
  it("уведомление о смене счёта выплаты: последних 4 символов IBAN нет ни в списке, ни в карточке, поиск по ним — 0 строк", async () => {
    const admin = await makeAdmin();
    const executor = await makeExecutor({ legalName: "ИП Счетов" });
    const last4 = "Ю7Ю8";
    const n = ru.identity.payout.notify;
    const mine = await db.notification.create({ data: { userId: executor.id, kind: "executor.payout_iban_changed", title: n.title(false), body: n.body(last4) } });
    await db.notification.create({ data: { userId: admin.id, kind: "executor.payout_iban_changed", title: n.title(false), body: n.operatorBody("ИП Счетов", false, last4) } });

    const list = await listRecords(admin, "Notification", {});
    expect(list.total).toBe(2);
    expect(list.columns).not.toEqual(expect.arrayContaining(["title"]));
    expect(list.columns).not.toEqual(expect.arrayContaining(["body"]));
    const card = await getRecord(admin, "Notification", mine.id);
    for (const result of [list, card]) {
      const json = JSON.stringify(result);
      expect(json).not.toContain(last4);
      expect(json).not.toContain("KZ…");
    }
    for (const q of [last4, "KZ…", "Счёт для выплаты"]) expect((await listRecords(admin, "Notification", { q })).total, q).toBe(0);
  });
});

describe("админка: чтение не доверяет типам входа (Раунд 1)", () => {
  // Вход из адреса страницы и форм — строки; объект на их месте — попытка подставить оператор Prisma ({ contains: "" }).
  const bad = <T>(value: unknown) => value as T;

  it("объект вместо строки в поиске, переходе, фильтре и ключе карточки — VALIDATION, а не выборка всего", async () => {
    const admin = await makeAdmin();
    const request = await makeRequest();
    await makeOffer(request.id);
    const queries: RecordsQuery[] = [
      { q: bad<string>({ contains: "" }) },
      { where: { field: "requestId", value: bad<string>({ contains: "" }) } },
      { where: { field: bad<string>({ toString: "requestId" }), value: request.id } },
      { where: bad<{ field: string; value: string }>("requestId") },
      { filters: { status: bad<string>({ not: "WITHDRAWN" }) } },
      { filters: bad<Record<string, string>>("status") },
    ];
    for (const query of queries) {
      await expect(listRecords(admin, "Offer", query), JSON.stringify(query)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(getRecord(admin, "Offer", bad<string>({ not: "" }))).rejects.toMatchObject({ code: "VALIDATION" });
    // Нечисловая страница — первая.
    expect((await listRecords(admin, "Offer", { page: bad<number>("2") })).page).toBe(1);
  });
});
