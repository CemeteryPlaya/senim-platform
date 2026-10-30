import { describe, expect, it } from "vitest";
import { testBin, testIin } from "@/demo/kz-id";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { registerExecutor, reviewExecutorRegistration, type ExecutorRegistrationInput } from "./registration";

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);

const selfEmployed: ExecutorRegistrationInput = {
  legalForm: "SELF_EMPLOYED",
  legalName: "Ерлан Жумабаев",
  binIin: IIN,
  city: "Астана",
  yearsExperience: 7,
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
}

describe("registerExecutor", () => {
  it("создаёт профиль PENDING с зашифрованным ИИН, меняет роль и уведомляет операторов", async () => {
    const [op1, op2] = [await makeOperator(), await makeOperator()];
    const user = await makeClient();

    const { profileId } = await registerExecutor(user, selfEmployed);

    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId }, include: { user: true } });
    expect(profile).toMatchObject({
      userId: user.id,
      status: "PENDING",
      segment: null,
      legalForm: "SELF_EMPLOYED",
      legalName: "Ерлан Жумабаев",
      binIinLast4: IIN.slice(-4),
      city: "Астана",
      yearsExperience: 7,
    });
    expect(profile.binIinEnc).not.toContain(IIN);
    expect(decryptPii(profile.binIinEnc)).toBe(IIN);
    expect(profile.user.role).toBe("EXECUTOR");

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.registered" } });
    expect(audit).toMatchObject({ actorId: user.id, scope: `executor:${profileId}`, entityType: "executor", entityId: profileId });
    expect(JSON.stringify([audit.before, audit.after, audit.meta])).not.toContain(IIN);

    const notes = await db.notification.findMany({ where: { kind: "registration.pending" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([op1.id, op2.id].sort());
    expect(notes[0].link).toBe(`/operator/executors/${profileId}`);
  });

  it("ТОО регистрируется по БИН", async () => {
    const user = await makeClient();
    const { profileId } = await registerExecutor(user, { ...selfEmployed, legalForm: "TOO", legalName: "ТОО «Ағаш»", binIin: BIN });
    expect(decryptPii((await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } })).binIinEnc)).toBe(BIN);
  });

  it("повторная регистрация того же пользователя — конфликт", async () => {
    const user = await makeClient();
    await registerExecutor(user, selfEmployed);

    expect(await codeOf(registerExecutor({ ...user, role: "EXECUTOR" }, selfEmployed))).toBe("CONFLICT");
  });

  it("двойная отправка формы создаёт один профиль, второй ответ — понятный конфликт", async () => {
    const user = await makeClient();

    const results = await Promise.allSettled([registerExecutor(user, selfEmployed), registerExecutor(user, selfEmployed)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AppError);
    expect((rejected?.reason as AppError).code).toBe("CONFLICT");
    expect(await db.executorProfile.count()).toBe(1);
  });

  it("номер, на котором уже есть заявки заказчика, не становится исполнителем", async () => {
    const user = await makeClient();
    await db.request.create({ data: { clientId: user.id, mode: "TENDER" } });

    expect(await codeOf(registerExecutor(user, selfEmployed))).toBe("CONFLICT");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("CLIENT");
  });

  it("оператор не может зарегистрироваться исполнителем", async () => {
    expect(await codeOf(registerExecutor(await makeOperator(), selfEmployed))).toBe("FORBIDDEN");
  });

  it("после отказа можно исправить данные и подать снова", async () => {
    const operator = await makeOperator();
    const user = await makeClient();
    const { profileId } = await registerExecutor(user, selfEmployed);
    await reviewExecutorRegistration(operator, profileId, { approve: false, reason: "Не совпадает ФИО" });

    const again = await registerExecutor({ ...user, role: "EXECUTOR" }, { ...selfEmployed, legalName: "Жумабаев Ерлан" });

    expect(again.profileId).toBe(profileId);
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } })).toMatchObject({
      status: "PENDING",
      rejectReason: null,
      legalName: "Жумабаев Ерлан",
    });
  });
});

describe("reviewExecutorRegistration", () => {
  it("подтверждение: сегмент, дата проверки, аудит и уведомление исполнителю", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });

    await reviewExecutorRegistration(operator, ex.executor.id, { approve: true, segment: "PREMIUM" });

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: ex.executor.id } })).toMatchObject({
      status: "APPROVED",
      segment: "PREMIUM",
      reviewedAt: expect.any(Date),
    });
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "executor.approved" } })).toMatchObject({
      actorId: operator.id,
      scope: `executor:${ex.executor.id}`,
      after: { status: "APPROVED", segment: "PREMIUM" },
    });
    expect(await db.notification.findMany({ where: { userId: ex.id } })).toEqual([expect.objectContaining({ kind: "registration.approved" })]);
  });

  it("отказ: причина сохраняется и приходит исполнителю", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });

    await reviewExecutorRegistration(operator, ex.executor.id, { approve: false, reason: "  Нет документов  " });

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: ex.executor.id } })).toMatchObject({
      status: "REJECTED",
      rejectReason: "Нет документов",
    });
    const note = await db.notification.findFirstOrThrow({ where: { userId: ex.id } });
    expect(note).toMatchObject({ kind: "registration.rejected", link: "/register/executor" });
    expect(note.body).toContain("Нет документов");
  });

  it("отказ без причины — ошибка проверки", async () => {
    const ex = await makeExecutor({ status: "PENDING" });
    expect(await codeOf(reviewExecutorRegistration(await makeOperator(), ex.executor.id, { approve: false, reason: "  " }))).toBe("VALIDATION");
  });

  it("решает только оператор", async () => {
    const ex = await makeExecutor({ status: "PENDING" });
    expect(await codeOf(reviewExecutorRegistration(await makeClient(), ex.executor.id, { approve: true, segment: "ECONOMY" }))).toBe("FORBIDDEN");
    expect(await codeOf(reviewExecutorRegistration(ex, ex.executor.id, { approve: true, segment: "ECONOMY" }))).toBe("FORBIDDEN");
  });

  it("рассмотренную регистрацию повторно не меняет", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "APPROVED" });

    expect(await codeOf(reviewExecutorRegistration(operator, ex.executor.id, { approve: false, reason: "передумали" }))).toBe("CONFLICT");
  });

  it("одновременные решения: проходит ровно одно", async () => {
    const operator = await makeOperator();
    const ex = await makeExecutor({ status: "PENDING" });

    const results = await Promise.allSettled([
      reviewExecutorRegistration(operator, ex.executor.id, { approve: true, segment: "ECONOMY" }),
      reviewExecutorRegistration(operator, ex.executor.id, { approve: false, reason: "дубль" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: { in: ["executor.approved", "executor.rejected"] } } })).toBe(1);
  });

  it("неизвестный профиль — не найден", async () => {
    expect(await codeOf(reviewExecutorRegistration(await makeOperator(), "nope", { approve: true, segment: "ECONOMY" }))).toBe("NOT_FOUND");
  });
});
