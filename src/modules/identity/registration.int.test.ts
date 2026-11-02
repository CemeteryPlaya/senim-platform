import { describe, expect, it } from "vitest";
import { testBin, testIin } from "@/demo/kz-id";
import { agreeToContract } from "@/modules/requests";
import { decryptPii, encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeMeasured } from "../../../test/factories/requests";
import { registerExecutor, reviewExecutorRegistration, type ExecutorRegistrationInput } from "./registration";

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);

const selfEmployed: ExecutorRegistrationInput = {
  legalForm: "SELF_EMPLOYED",
  legalName: "Ерлан Жумабаев",
  binIin: IIN,
  city: "Астана",
  yearsExperience: 7,
  signer: { fullName: "Ерлан Жумабаев", iin: null },
};

const ip: ExecutorRegistrationInput = { ...selfEmployed, legalForm: "IP", legalName: "ИП «Дала»", signer: { fullName: "Жумабаев Ерлан", iin: null } };

const too: ExecutorRegistrationInput = {
  ...selfEmployed,
  legalForm: "TOO",
  legalName: "ТОО «Ағаш»",
  binIin: BIN,
  signer: { fullName: "Тулегенов Бауыржан", iin: DIRECTOR_IIN },
};

/** Вошёл по SMS: ни ФИО, ни ИИН в записи пользователя нет. */
async function smsUser() {
  const user = await makeClient();
  await db.user.update({ where: { id: user.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  return user;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
}

describe("registerExecutor", () => {
  it("создаёт профиль PENDING с зашифрованным ИИН, добавляет роль исполнителя и уведомляет операторов", async () => {
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
    // Роль добавлена к выданным, заказчик остаётся заказчиком (ADR-004); активную роль переключает экран.
    expect(profile.user.roles).toEqual(["CLIENT", "EXECUTOR"]);

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.registered" } });
    expect(audit).toMatchObject({ actorId: user.id, scope: `executor:${profileId}`, entityType: "executor", entityId: profileId });
    expect(JSON.stringify([audit.before, audit.after, audit.meta])).not.toContain(IIN);

    const notes = await db.notification.findMany({ where: { kind: "registration.pending" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([op1.id, op2.id].sort());
    expect(notes[0].link).toBe(`/operator/executors/${profileId}`);
  });

  it("ТОО регистрируется по БИН", async () => {
    const user = await makeClient();
    const { profileId } = await registerExecutor(user, too);
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

  it("тот же ИИН/БИН с другого номера — конфликт, в том числе при одновременной отправке", async () => {
    await registerExecutor(await makeClient(), selfEmployed);
    expect(await codeOf(registerExecutor(await makeClient(), selfEmployed))).toBe("CONFLICT");

    const [a, b] = [await makeClient(), await makeClient()];
    const codes = await Promise.all([registerExecutor(a, too), registerExecutor(b, too)].map((p) => codeOf(p).catch(() => "OK")));
    expect(codes.sort()).toEqual(["CONFLICT", "OK"]);
    expect(await db.executorProfile.count()).toBe(2);
  });

  it("перебор ИИН/БИН упирается в лимит: не больше 5 попыток регистрации в час", async () => {
    await registerExecutor(await makeClient(), selfEmployed);
    const prober = await makeClient();
    for (let i = 0; i < 5; i++) expect(await codeOf(registerExecutor(prober, selfEmployed))).toBe("CONFLICT");
    expect(await codeOf(registerExecutor(prober, selfEmployed))).toBe("RATE_LIMITED");
  });

  it("заказчик с заявками становится исполнителем на том же номере: роль CLIENT и заявки остаются", async () => {
    const user = await makeClient();
    const request = await db.request.create({ data: { clientId: user.id, mode: "TENDER" } });

    await registerExecutor(user, selfEmployed);

    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "CLIENT", roles: ["CLIENT", "EXECUTOR"] });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ clientId: user.id });
  });

  it("повторная подача после отказа не дублирует роль исполнителя", async () => {
    const user = await makeClient();
    const { profileId } = await registerExecutor(user, selfEmployed);
    await reviewExecutorRegistration(await makeOperator(), profileId, { approve: false, reason: "Опечатка" });
    await registerExecutor({ ...user, role: "EXECUTOR" }, selfEmployed);

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
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

describe("подписант договора — свойство профиля, а не аккаунта", () => {
  const profileOf = (profileId: string) => db.executorProfile.findUniqueOrThrow({ where: { id: profileId } });
  const accountOf = (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId } });

  it("ТОО: ФИО и ИИН директора — в профиле (ИИН только зашифрованным), аккаунт не меняется", async () => {
    const user = await smsUser();
    const { profileId } = await registerExecutor(user, too);

    const profile = await profileOf(profileId);
    expect(profile).toMatchObject({ signerFullName: "Тулегенов Бауыржан", signerIinHash: hashPii(DIRECTOR_IIN) });
    expect(profile.signerIinEnc).not.toContain(DIRECTOR_IIN);
    expect(decryptPii(profile.signerIinEnc!)).toBe(DIRECTOR_IIN);
    expect(await accountOf(user.id)).toMatchObject({ fullName: null, iinHash: null, iinEnc: null });
    const audit = await db.auditEvent.findMany({ where: { actorId: user.id } });
    expect(JSON.stringify(audit.map((a) => [a.before, a.after, a.meta]))).not.toContain(DIRECTOR_IIN);
  });

  it("ИП и самозанятый: подписывает владелец — ФИО в профиле, ИИН — ИИН профиля, отдельного ИИН подписанта нет", async () => {
    const a = await registerExecutor(await smsUser(), ip);
    expect(await profileOf(a.profileId)).toMatchObject({ signerFullName: "Жумабаев Ерлан", signerIinEnc: null, signerIinHash: null, binIinHash: hashPii(IIN) });
    const b = await registerExecutor(await smsUser(), { ...selfEmployed, binIin: testIin("930114", 3, 24) });
    expect(await profileOf(b.profileId)).toMatchObject({ signerFullName: "Ерлан Жумабаев", signerIinHash: null });
  });

  it("один директор у двух ТОО: оба регистрируются", async () => {
    await registerExecutor(await smsUser(), too);
    const second = await registerExecutor(await smsUser(), { ...too, legalName: "ТОО «Шебер»", binIin: testBin("2101", 17) });
    expect(await profileOf(second.profileId)).toMatchObject({ signerIinHash: hashPii(DIRECTOR_IIN) });
    expect(await db.executorProfile.count({ where: { signerIinHash: hashPii(DIRECTOR_IIN) } })).toBe(2);
  });

  it("владелец ИП с аккаунтом заказчика (его ИИН уже в аккаунте) регистрирует ИП на другой номер", async () => {
    const asClient = await makeClient();
    await db.user.update({ where: { id: asClient.id }, data: { iinEnc: encryptPii(IIN), iinHash: hashPii(IIN), iinLast4: last4(IIN) } });

    const { profileId } = await registerExecutor(await smsUser(), ip);
    expect(await profileOf(profileId)).toMatchObject({ binIinHash: hashPii(IIN), status: "PENDING" });
    expect(await accountOf(asClient.id)).toMatchObject({ iinHash: hashPii(IIN) });
  });

  it("заказчик с ИИН в аккаунте регистрирует ИП на свой же ИИН на том же номере — без «ИИН занят» (№28)", async () => {
    const me = await smsUser();
    await db.user.update({ where: { id: me.id }, data: { fullName: "Жумабаев Ерлан", iinEnc: encryptPii(IIN), iinHash: hashPii(IIN), iinLast4: last4(IIN) } });

    const { profileId } = await registerExecutor(me, ip);

    expect(await profileOf(profileId)).toMatchObject({ userId: me.id, binIinHash: hashPii(IIN), status: "PENDING" });
    expect(await accountOf(me.id)).toMatchObject({ iinHash: hashPii(IIN), roles: ["CLIENT", "EXECUTOR"] });
  });

  it("директор ТОО с ИИН заказчика в том же аккаунте регистрирует ТОО (№28)", async () => {
    const me = await smsUser();
    await db.user.update({ where: { id: me.id }, data: { iinEnc: encryptPii(DIRECTOR_IIN), iinHash: hashPii(DIRECTOR_IIN), iinLast4: last4(DIRECTOR_IIN) } });

    const { profileId } = await registerExecutor(me, too);
    expect(await profileOf(profileId)).toMatchObject({ signerIinHash: hashPii(DIRECTOR_IIN) });
  });

  it("исполнитель-ИП, ставший заказчиком, указывает перед договором тот же ИИН, что у профиля; чужой аккаунт с этим ИИН — нет", async () => {
    const me = await smsUser();
    await registerExecutor(me, ip);
    const m = await makeMeasured(me);

    await agreeToContract(me, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Жумабаев Ерлан", iin: IIN } });
    expect(await accountOf(me.id)).toMatchObject({ iinHash: hashPii(IIN) });

    // Один ИИН заказчика — один аккаунт: для чужих правило остаётся.
    const other = await smsUser();
    const m2 = await makeMeasured(other);
    expect(await codeOf(agreeToContract(other, { requestId: m2.requestId, template: "advance-50", identity: { fullName: "Жумабаев Ерлан", iin: IIN } }))).toBe("CONFLICT");
  });

  it("чужой ИИН в анкете ТОО не мешает настоящему владельцу ИИН указать его перед договором", async () => {
    // Кто-то вписал в анкету ТОО ИИН заказчика как ИИН «директора».
    await registerExecutor(await smsUser(), too);
    const owner = await smsUser();
    const m = await makeMeasured(owner);

    await agreeToContract(owner, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Тулегенов Бауыржан", iin: DIRECTOR_IIN } });
    expect(await accountOf(owner.id)).toMatchObject({ iinHash: hashPii(DIRECTOR_IIN) });
  });

  it("повторная подача ТОО после отказа: новый директор заменяет прежнего в профиле", async () => {
    const operator = await makeOperator();
    const user = await smsUser();
    const { profileId } = await registerExecutor(user, too);
    await reviewExecutorRegistration(operator, profileId, { approve: false, reason: "Директор указан неверно" });

    const newDirector = testIin("820304", 4, 42);
    await registerExecutor({ ...user, role: "EXECUTOR" }, { ...too, signer: { fullName: "Ахметова Сауле", iin: newDirector } });
    expect(await profileOf(profileId)).toMatchObject({ signerFullName: "Ахметова Сауле", signerIinHash: hashPii(newDirector) });
  });

  it("повторная подача после отказа со сменой ТОО на ИП: ИИН прежнего директора стирается", async () => {
    const user = await smsUser();
    const { profileId } = await registerExecutor(user, too);
    await reviewExecutorRegistration(await makeOperator(), profileId, { approve: false, reason: "Работаете как ИП" });

    await registerExecutor({ ...user, role: "EXECUTOR" }, ip);
    expect(await profileOf(profileId)).toMatchObject({ legalForm: "IP", signerFullName: "Жумабаев Ерлан", signerIinEnc: null, signerIinHash: null });
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
