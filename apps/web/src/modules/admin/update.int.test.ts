import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeAdmin, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeFurnitureType } from "../../../test/factories/companies";
import { dealAt } from "../../../test/factories/deal";
import { makeRequest } from "../../../test/factories/operator";
import { updateRecord, type FieldChange } from "./update";

const audit = () => db.auditEvent.findMany({ where: { action: "admin.record.updated" }, orderBy: { seq: "asc" } });
const withoutMfa = (user: CurrentUser): CurrentUser => ({ ...user, mfa: { required: true, verifiedAt: null } });
const failure = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Снимок данных, которые могла бы задеть правка: всё, что видно базе, и число записей журнала аудита. */
async function snapshot() {
  return JSON.stringify(
    {
      furniture: await db.furnitureType.findMany({ orderBy: { id: "asc" } }),
      deals: await db.deal.findMany({ orderBy: { id: "asc" } }),
      money: await db.moneyTransaction.findMany({ orderBy: { id: "asc" } }),
      users: await db.user.findMany({ orderBy: { id: "asc" } }),
      profiles: await db.executorProfile.findMany({ orderBy: { id: "asc" } }),
      audit: await db.auditEvent.count(),
    },
    (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
  );
}

describe("админка: правка записи", () => {
  it("правка названия вида мебели: значение изменено, одна запись аудита только с этим полем", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });

    await expect(updateRecord(admin, { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] })).resolves.toEqual({ changed: 1 });

    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухни");
    const events = await audit();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: admin.id, actorRole: "ADMIN", entityType: "FurnitureType", entityId: type.id, before: { name: "Кухня" }, after: { name: "Кухни" } });
  });

  it("несколько полей разных типов; поле без изменения в аудит не попадает", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Шкаф", active: true });
    const { sortOrder } = type;
    await updateRecord(admin, {
      model: "FurnitureType",
      id: type.id,
      changes: [
        { field: "name", from: "Шкаф", to: "Шкаф" },
        { field: "active", from: "true", to: "false" },
        { field: "sortOrder", from: String(sortOrder), to: "77" },
      ],
    });
    expect(await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).toMatchObject({ name: "Шкаф", active: false, sortOrder: 77 });
    const [event] = await audit();
    expect(event.before).toEqual({ active: true, sortOrder });
    expect(event.after).toEqual({ active: false, sortOrder: 77 });
  });

  it("необязательные поля: пустая строка — null; прежнее null совпадает и с пустой строкой в базе", async () => {
    const admin = await makeAdmin();
    const request = await makeRequest();
    await updateRecord(admin, { model: "Request", id: request.id, changes: [{ field: "customType", from: "", to: "Комод" }] });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).customType).toBe("Комод");
    await updateRecord(admin, { model: "Request", id: request.id, changes: [{ field: "customType", from: "Комод", to: "" }] });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).customType).toBeNull();
    // В базе пустая строка (записал другой код): форма пришлёт пустое прежнее значение — правка проходит.
    await db.request.update({ where: { id: request.id }, data: { customType: "" } });
    await updateRecord(admin, { model: "Request", id: request.id, changes: [{ field: "customType", from: null, to: "Полка" }] });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).customType).toBe("Полка");
    // Обязательная строка с пустым значением по умолчанию: пустое прежнее значение допустимо.
    await updateRecord(admin, { model: "Request", id: request.id, changes: [{ field: "wishes", from: "", to: "Светлые фасады" }] });
    expect(await audit()).toHaveLength(4);
  });

  it("нет изменений — { changed: 0 } без аудита", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });
    await expect(updateRecord(admin, { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухня" }] })).resolves.toEqual({ changed: 0 });
    await expect(updateRecord(admin, { model: "FurnitureType", id: type.id, changes: [] })).resolves.toEqual({ changed: 0 });
    expect(await audit()).toHaveLength(0);
  });
});

describe("админка: подмена модели или поля в форме (Review Focus 1)", () => {
  it("запрещённые модели и поля — отказ: данные и журнал аудита не меняются, в ошибке нет значения скрытого поля", async () => {
    const admin = await makeAdmin();
    const { dealId, executor } = await dealAt("PAID_HOLD");
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    const money = await db.moneyTransaction.findFirstOrThrow({ where: { dealId } });
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } });
    const type = await makeFurnitureType({ name: "Кухня" });
    const hash = profile.binIinHash ?? "";
    expect(hash).not.toBe("");

    const attempts: [string, Parameters<typeof updateRecord>[1]][] = [
      ["MoneyTransaction.status", { model: "MoneyTransaction", id: money.id, changes: [{ field: "status", from: money.status, to: "FAILED" }] }],
      ["MoneyTransaction.amountTiyn", { model: "MoneyTransaction", id: money.id, changes: [{ field: "amountTiyn", from: String(money.amountTiyn), to: "1" }] }],
      ["Deal.status", { model: "Deal", id: dealId, changes: [{ field: "status", from: deal.status, to: "SPLIT_PAYOUT" }] }],
      ["Deal.priceTiyn", { model: "Deal", id: dealId, changes: [{ field: "priceTiyn", from: String(deal.priceTiyn), to: "1" }] }],
      ["Deal.title", { model: "Deal", id: dealId, changes: [{ field: "title", from: deal.title, to: "Другое" }] }],
      ["User.fullName", { model: "User", id: executor.id, changes: [{ field: "fullName", from: executor.fullName, to: "Другой" }] }],
      ["ExecutorProfile.binIinHash", { model: "ExecutorProfile", id: profile.id, changes: [{ field: "binIinHash", from: hash, to: "x" }] }],
      ["ExecutorProfile.status", { model: "ExecutorProfile", id: profile.id, changes: [{ field: "status", from: profile.status, to: "REJECTED" }] }],
      ["ExecutorProfile.userId", { model: "ExecutorProfile", id: profile.id, changes: [{ field: "userId", from: profile.userId, to: admin.id }] }],
      ["FurnitureType.id", { model: "FurnitureType", id: type.id, changes: [{ field: "id", from: type.id, to: "x" }] }],
      ["FurnitureType.createdAt", { model: "FurnitureType", id: type.id, changes: [{ field: "createdAt", from: type.createdAt.toISOString(), to: "2020-01-01T00:00:00.000Z" }] }],
      ["FurnitureType.slug", { model: "FurnitureType", id: type.id, changes: [{ field: "slug", from: type.slug, to: "x" }] }],
      ["FurnitureType.executors", { model: "FurnitureType", id: type.id, changes: [{ field: "executors", from: null, to: profile.id }] }],
      ["ExecutorHighlight.position", { model: "ExecutorHighlight", id: "x", changes: [{ field: "position", from: "0", to: "1" }] }],
      ["неизвестное поле", { model: "FurnitureType", id: type.id, changes: [{ field: "nope", from: null, to: "x" }] }],
      ["поле прототипа", { model: "FurnitureType", id: type.id, changes: [{ field: "__proto__", from: null, to: "x" }] }],
      ["разрешённое вместе с запрещённым", { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }, { field: "slug", from: type.slug, to: "x" }] }],
      ["неизвестная модель", { model: "Nope", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] }],
      ["имя свойства клиента", { model: "$transaction", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] }],
      ["модель с маленькой буквы", { model: "furnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] }],
    ];

    const before = await snapshot();
    for (const [name, input] of attempts) {
      const error = await failure(updateRecord(admin, input));
      expect(error, name).toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|VALIDATION)$/) });
      expect(`${String(error)} ${JSON.stringify(error)}`, name).not.toContain(hash);
    }
    expect(await snapshot()).toBe(before);
    expect(await audit()).toHaveLength(0);
  });

  it("оператор и покупатель — FORBIDDEN, администратор без второго фактора — MFA_REQUIRED; без изменений и аудита", async () => {
    const type = await makeFurnitureType({ name: "Кухня" });
    const input = { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] };
    for (const user of [await makeOperator(), await makeClient(), await makeExecutor(), withoutMfa(await makeOperator())]) {
      await expect(updateRecord(user, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(updateRecord(withoutMfa(await makeAdmin()), input)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухня");
    expect(await audit()).toHaveLength(0);
  });
});

describe("админка: проверка значений", () => {
  it("обязательное поле в пустую строку, неверное число и булево — VALIDATION с ошибками у полей, без изменений", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });
    const error = await failure(
      updateRecord(admin, {
        model: "FurnitureType",
        id: type.id,
        changes: [
          { field: "name", from: "Кухня", to: "" },
          { field: "sortOrder", from: String(type.sortOrder), to: "1.5" },
          { field: "active", from: "true", to: "да" },
        ],
      }),
    );
    const t = ru.app.admin.record.errors;
    expect(error).toMatchObject({ code: "VALIDATION", details: { fieldErrors: { name: [t.required], sortOrder: [t.int], active: [t.boolean] } } });
    expect(await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).toMatchObject({ name: "Кухня", active: true });
    expect(await audit()).toHaveLength(0);
  });

  it("одно поле дважды — VALIDATION", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });
    const changes = [{ field: "name", from: "Кухня", to: "А" }, { field: "name", from: "Кухня", to: "Б" }];
    await expect(updateRecord(admin, { model: "FurnitureType", id: type.id, changes })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await audit()).toHaveLength(0);
  });
});

describe("админка: одновременная правка (Review Focus 5)", () => {
  it("две правки с одинаковым прежним значением: одна применена, вторая — CONFLICT, аудит — одна запись", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });
    const edit = (to: string) => updateRecord(admin, { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to }] });

    const results = await Promise.allSettled([edit("Кухня А"), edit("Кухня Б")]);

    const done = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(done).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ reason: { code: "CONFLICT", message: ru.app.admin.record.conflict } });
    const events = await audit();
    expect(events).toHaveLength(1);
    const { name } = await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } });
    expect(events[0].after).toEqual({ name });
  });

  it("прежнее значение не совпало с текущим — CONFLICT без аудита; нет записи — CONFLICT", async () => {
    const admin = await makeAdmin();
    const type = await makeFurnitureType({ name: "Кухня" });
    await db.furnitureType.update({ where: { id: type.id }, data: { name: "Кухня (правка оператора)" } });
    await expect(updateRecord(admin, { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухня (правка оператора)");
    await expect(updateRecord(admin, { model: "FurnitureType", id: "нет-такой", changes: [{ field: "name", from: "Кухня", to: "Кухни" }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await audit()).toHaveLength(0);
  });
});

describe("админка: правка не доверяет типам входа и ограничениям базы (Раунд 1)", () => {
  const bad = <T>(value: unknown) => value as T;

  it("объект вместо строки в ключе, прежнем и новом значении, не массив изменений — VALIDATION, ничего не меняется", async () => {
    const admin = await makeAdmin();
    // Единственная запись: ключ { not: "" } совпал бы ровно с ней, и условное обновление прошло бы.
    const type = await makeFurnitureType({ name: "Кухня" });
    const attempts: Parameters<typeof updateRecord>[1][] = [
      { model: "FurnitureType", id: bad<string>({ not: "" }), changes: [{ field: "name", from: "Кухня", to: "Кухни" }] },
      { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: bad<string>({ not: "" }), to: "Кухни" }] },
      { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: bad<string>({ set: "Кухни" }) }] },
      { model: "FurnitureType", id: type.id, changes: [{ field: "sortOrder", from: bad<string>(0), to: "5" }] },
      { model: "FurnitureType", id: type.id, changes: bad<FieldChange[]>({ 0: { field: "name", from: "Кухня", to: "Кухни" }, length: 1 }) },
    ];
    const before = await snapshot();
    for (const input of attempts) {
      await expect(updateRecord(admin, input), JSON.stringify(input)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await snapshot()).toBe(before);
  });

  it("нарушение уникальности — CONFLICT (не 500), аудит откатывается", async () => {
    const admin = await makeAdmin();
    await makeFurnitureType({ name: "Кухня" });
    const other = await makeFurnitureType({ name: "Шкаф" });
    // Ни одно редактируемое поле сейчас не уникально: индекс — только на время теста.
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX "admin_test_furniture_name" ON "FurnitureType"("name")`);
    try {
      const error = await failure(updateRecord(admin, { model: "FurnitureType", id: other.id, changes: [{ field: "name", from: "Шкаф", to: "Кухня" }] }));
      expect(error).toMatchObject({ code: "CONFLICT" });
    } finally {
      await db.$executeRawUnsafe(`DROP INDEX "admin_test_furniture_name"`);
    }
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: other.id } })).name).toBe("Шкаф");
    expect(await audit()).toHaveLength(0);
  });

  it("значение, которое не принимает ограничение базы (CHECK), — VALIDATION, аудит откатывается", async () => {
    const admin = await makeAdmin();
    const price = await db.materialPrice.create({ data: { category: "carcass", name: "ЛДСП 16 мм", unit: "m2", priceKzt: 4_500, segments: ["ECONOMY"] } });
    const error = await failure(updateRecord(admin, { model: "MaterialPrice", id: price.id, changes: [{ field: "priceKzt", from: "4500", to: "0" }] }));
    expect(error).toMatchObject({ code: "VALIDATION" });
    expect((await db.materialPrice.findUniqueOrThrow({ where: { id: price.id } })).priceKzt).toBe(4_500);
    expect(await audit()).toHaveLength(0);
  });
});
