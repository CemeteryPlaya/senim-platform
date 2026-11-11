import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegalForm } from "@/gen/senim/identity/v1/identity_pb";
import { testBin, testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { hashPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { mirrorUser, signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import {
  addExecutor,
  changeSegment,
  getExecutorCard,
  listRegistrationQueue,
  reviewRegistration,
} from "./executors";
import { addExecutorSchema } from "./schemas";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

// Тестовый БИН с верной контрольной цифрой (алгоритм РК).
const VALID_BIN = "210140000016";
const DIRECTOR_IIN = testIin("800215", 3, 61);

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
  const raw = {
    phone: "+7 700 111 22 33",
    legalForm: "TOO",
    legalName: "ТОО «Новый цех»",
    binIin: VALID_BIN,
    directorName: "Тулегенов Бауыржан",
    directorIin: DIRECTOR_IIN,
    segment: "COMFORT",
  };
  const input = addExecutorSchema.parse(raw);
  const t = ru.operator.errors;
  const provisionCalls = () => identityFake.calls.filter((c) => c.method === "provisionExecutor");

  /** Оператор после входа со второй ступенью (ProvisionExecutor требует mfa_verified_at). */
  async function signedInOperator(opts: { mfaVerifiedAt?: Date | null } = {}) {
    const operator = await makeOperator();
    await signInAs(operator, undefined, opts);
    return operator;
  }

  it("ProvisionExecutor создаёт пользователя в identity; проекция — User и подтверждённый профиль без шифртекстов", async () => {
    const operator = await signedInOperator();

    const { profileId } = await addExecutor(operator, input);

    expect(provisionCalls()[0].request).toMatchObject({
      phone: "+77001112233",
      legalForm: LegalForm.TOO,
      legalName: "ТОО «Новый цех»",
      binIin: VALID_BIN,
      signerFullName: "Тулегенов Бауыржан",
      signerIin: DIRECTOR_IIN,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId }, include: { user: true } });
    expect(profile).toMatchObject({
      status: "APPROVED",
      segment: "COMFORT",
      addedByOperator: true,
      legalForm: "TOO",
      legalName: "ТОО «Новый цех»",
      binIinLast4: VALID_BIN.slice(-4),
      signerFullName: "Тулегенов Бауыржан",
      kycStatus: "PENDING",
      binIinEnc: null,
      binIinHash: null,
      signerIinEnc: null,
      signerIinHash: null,
      user: { role: "EXECUTOR", roles: ["EXECUTOR"], phone: "+77001112233", fullName: null, iinHash: null },
    });
    // Тот же id, что у пользователя identity: строка User — проекция, а не отдельная запись web.
    expect(identityFake.hasUser(profile.userId)).toBe(true);
    expect(identityFake.partyNumbersOf(profile.userId)).toMatchObject({ binIin: VALID_BIN, signerIin: DIRECTOR_IIN });
    expect(await db.auditEvent.count({ where: { action: "executor.added_by_operator", scope: `executor:${profileId}` } })).toBe(1);
    expect(await db.notification.count({ where: { userId: profile.userId, kind: "executor.added" } })).toBe(1);
  });

  it("ИП: подписант — владелец, ИИН стороны — из анкеты оператора", async () => {
    const iin = testIin("880512", 3, 62);
    const ip = addExecutorSchema.parse({ phone: "+7 700 111 22 44", legalForm: "IP", legalName: "ИП Тестовый", ownerName: "Тестов Тест", binIin: iin, segment: "ECONOMY" });
    const { profileId } = await addExecutor(await signedInOperator(), ip);
    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } });
    expect(profile).toMatchObject({ signerFullName: "Тестов Тест", binIinLast4: iin.slice(-4), binIinHash: null });
    expect(identityFake.partyNumbersOf(profile.userId)).toMatchObject({ binIin: iin, signerIin: "" });
  });

  it("ИИН директора уже указан в другом аккаунте или у другого ТОО — исполнитель всё равно добавляется", async () => {
    const operator = await signedInOperator();
    const other = await makeClient();
    await db.user.update({ where: { id: other.id }, data: { iinHash: hashPii(DIRECTOR_IIN) } });
    await addExecutor(operator, input);
    await addExecutor(operator, addExecutorSchema.parse({ ...raw, phone: "+7 700 111 22 55", binIin: testBin("2101", 18) }));
    expect(await db.executorProfile.count({ where: { signerFullName: "Тулегенов Бауыржан" } })).toBe(2);
  });

  it("тот же телефон с другими реквизитами — CONFLICT (party_exists), второго пользователя нет", async () => {
    const operator = await signedInOperator();
    await addExecutor(operator, input);

    await expect(addExecutor(operator, { ...input, legalName: "Другое" })).rejects.toMatchObject({ code: "CONFLICT", message: t.partyExists });
    expect(await db.user.count({ where: { phone: input.phone } })).toBe(1);
  });

  it("тот же телефон и те же реквизиты ещё раз — CONFLICT «уже есть», профиль один", async () => {
    const operator = await signedInOperator();
    await addExecutor(operator, input);

    await expect(addExecutor(operator, input)).rejects.toMatchObject({ code: "CONFLICT", message: t.phoneTaken });
    expect(await db.executorProfile.count()).toBe(1);
  });

  it("тот же ИИН/БИН на другой телефон — CONFLICT с текстом оператора, пользователь не создан", async () => {
    const operator = await signedInOperator();
    await addExecutor(operator, input);

    const otherPhone = addExecutorSchema.parse({ ...raw, phone: "+7 700 111 22 99" });
    await expect(addExecutor(operator, otherPhone)).rejects.toMatchObject({ code: "CONFLICT", message: t.binIinTaken });
    expect(await db.executorProfile.count()).toBe(1);
    expect(await db.user.count({ where: { phone: otherPhone.phone } })).toBe(0);
  });

  it("номер заказчика: identity добавляет роль исполнителя, заказчик остаётся заказчиком", async () => {
    const operator = await signedInOperator();
    const client = await makeClient();
    await mirrorUser(client.id);

    const { profileId } = await addExecutor(operator, addExecutorSchema.parse({ ...raw, phone: client.phone }));

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } })).toMatchObject({ userId: client.id });
    expect((await db.user.findUniqueOrThrow({ where: { id: client.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
  });

  it("номер сотрудника — отказ с текстом, профиль не создан", async () => {
    const operator = await signedInOperator();
    await expect(addExecutor(operator, addExecutorSchema.parse({ ...raw, phone: operator.phone }))).rejects.toMatchObject({ code: "CONFLICT", message: t.staffPhone });
    expect(await db.executorProfile.count()).toBe(0);
  });

  it("заблокированный номер — отказ с текстом", async () => {
    const operator = await signedInOperator();
    const blocked = await makeClient();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    await mirrorUser(blocked.id);
    await expect(addExecutor(operator, addExecutorSchema.parse({ ...raw, phone: blocked.phone }))).rejects.toMatchObject({ code: "CONFLICT", message: t.phoneBlocked });
  });

  it("оператор без второй ступени — MFA_REQUIRED, ничего не создано", async () => {
    const operator = await signedInOperator({ mfaVerifiedAt: null });
    await expect(addExecutor(operator, input)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(await db.executorProfile.count()).toBe(0);
    expect(await db.user.count({ where: { phone: input.phone } })).toBe(0);
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
