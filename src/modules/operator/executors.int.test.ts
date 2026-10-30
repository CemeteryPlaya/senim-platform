import { describe, expect, it } from "vitest";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import {
  addExecutor,
  changeSegment,
  getExecutorCard,
  listRegistrationQueue,
  reviewRegistration,
} from "./executors";
import { addExecutorSchema } from "./schemas";

// Тестовый БИН с верной контрольной цифрой (алгоритм РК).
const VALID_BIN = "210140000016";

describe("очередь регистраций", () => {
  it("показывает только PENDING и раскрывает лишь последние 4 цифры ИИН/БИН", async () => {
    const operator = await makeOperator();
    const pending = await makeExecutor({ status: "PENDING", legalName: "ИП Ждущий" });
    await makeExecutor({ status: "APPROVED" });

    const queue = await listRegistrationQueue(operator);

    expect(queue.map((r) => r.id)).toEqual([pending.executor.id]);
    expect(queue[0]).toMatchObject({ legalName: "ИП Ждущий", binIinLast4: expect.stringMatching(/^\d{4}$/) });
    expect(JSON.stringify(queue)).not.toMatch(/binIinEnc|v1\./);
  });

  it("подтверждение ставит сегмент, пишет аудит и уведомляет исполнителя", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });

    await reviewRegistration(operator, { profileId: ex.executor.id, decision: { approve: true, segment: "PREMIUM" } });

    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: ex.executor.id } });
    expect(profile).toMatchObject({ status: "APPROVED", segment: "PREMIUM", reviewedAt: expect.any(Date) });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.approved" } });
    expect(audit).toMatchObject({ actorId: operator.id, scope: `executor:${ex.executor.id}`, after: { status: "APPROVED", segment: "PREMIUM" } });
    expect(await db.notification.count({ where: { userId: ex.id } })).toBe(1);
  });

  it("отклонение сохраняет причину", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });

    await reviewRegistration(operator, { profileId: ex.executor.id, decision: { approve: false, reason: "Нет фото работ" } });

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: ex.executor.id } })).toMatchObject({
      status: "REJECTED",
      rejectReason: "Нет фото работ",
    });
    expect(await db.auditEvent.count({ where: { action: "executor.rejected" } })).toBe(1);
  });

  it("двойное подтверждение даёт ровно один успех", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });
    const decide = () => reviewRegistration(operator, { profileId: ex.executor.id, decision: { approve: true, segment: "ECONOMY" } });

    const results = await Promise.allSettled([decide(), decide()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "executor.approved" } })).toBe(1);
  });

  it("уже рассмотренную регистрацию повторно не меняет", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "REJECTED" });

    await expect(
      reviewRegistration(operator, { profileId: ex.executor.id, decision: { approve: true, segment: "ECONOMY" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("ручное добавление исполнителя", () => {
  const input = addExecutorSchema.parse({
    phone: "+7 700 111 22 33",
    legalForm: "TOO",
    legalName: "ТОО «Новый цех»",
    binIin: VALID_BIN,
    segment: "COMFORT",
  });

  it("создаёт подтверждённого исполнителя с зашифрованным БИН и пометкой addedByOperator", async () => {
    const operator = await makeOperator();

    const { profileId } = await addExecutor(operator, input);

    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId }, include: { user: true } });
    expect(profile).toMatchObject({
      status: "APPROVED",
      segment: "COMFORT",
      addedByOperator: true,
      legalForm: "TOO",
      binIinLast4: VALID_BIN.slice(-4),
      user: { role: "EXECUTOR", phone: "+77001112233" },
    });
    expect(profile.binIinEnc).not.toContain(VALID_BIN);
    expect(decryptPii(profile.binIinEnc)).toBe(VALID_BIN);
    expect(await db.auditEvent.count({ where: { action: "executor.added_by_operator", scope: `executor:${profileId}` } })).toBe(1);
  });

  it("не создаёт второго пользователя с тем же телефоном", async () => {
    const operator = await makeOperator();
    await addExecutor(operator, input);

    await expect(addExecutor(operator, { ...input, legalName: "Другое" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count({ where: { phone: input.phone } })).toBe(1);
  });

  it("не создаёт второго исполнителя с тем же ИИН/БИН на другой телефон", async () => {
    const operator = await makeOperator();
    await addExecutor(operator, input);

    const otherPhone = addExecutorSchema.parse({ ...input, phone: "+7 700 111 22 99" });
    await expect(addExecutor(operator, otherPhone)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.executorProfile.count()).toBe(1);
  });
});

describe("смена сегмента", () => {
  it("меняет сегмент с причиной и пишет в аудит до и после", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ segment: "COMFORT" });

    await changeSegment(operator, { profileId: ex.executor.id, from: "COMFORT", to: "PREMIUM", reason: "Портфолио премиум-уровня" });

    expect((await db.executorProfile.findUniqueOrThrow({ where: { id: ex.executor.id } })).segment).toBe("PREMIUM");
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.segment.changed" } });
    expect(audit).toMatchObject({
      actorId: operator.id,
      before: { segment: "COMFORT" },
      after: { segment: "PREMIUM" },
      meta: { reason: "Портфолио премиум-уровня" },
    });
    expect(await db.notification.count({ where: { userId: ex.id } })).toBe(1);
  });

  it("отказывает, если сегмент уже изменил другой оператор", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ segment: "ECONOMY" });

    await expect(
      changeSegment(operator, { profileId: ex.executor.id, from: "COMFORT", to: "PREMIUM", reason: "Повышение уровня" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("не меняет сегмент неподтверждённому исполнителю", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING", segment: "COMFORT" });

    await expect(
      changeSegment(operator, { profileId: ex.executor.id, from: "COMFORT", to: "PREMIUM", reason: "Повышение уровня" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("карточка исполнителя", () => {
  it("содержит историю из журнала и не содержит телефон целиком", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });
    await reviewRegistration(operator, { profileId: ex.executor.id, decision: { approve: true, segment: "COMFORT" } });

    const card = await getExecutorCard(operator, ex.executor.id);

    expect(card.history.map((e) => e.action)).toEqual(["executor.approved"]);
    expect(card.phoneLast4).toBe(ex.phone.slice(-4));
    expect(JSON.stringify(card)).not.toContain(ex.phone);
  });

  it("чужой роли недоступна", async () => {
    const client = await makeClient();
    const ex = await makeExecutor();
    await expect(getExecutorCard(client, ex.executor.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
