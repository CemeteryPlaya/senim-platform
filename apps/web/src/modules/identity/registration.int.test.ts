import { beforeEach, describe, expect, it, vi } from "vitest";
import { KycStatus, LegalForm } from "@/gen/senim/identity/v1/identity_pb";
import { testBin, testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { agreeToContract } from "@/modules/requests";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeMeasured, withPreContractFlows } from "../../../test/factories/requests";
import { asBrowser, freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { registerExecutor as register, reviewExecutorRegistration, type ExecutorRegistrationInput } from "./registration";
import { getCurrentUser } from "./session";
import { sessionCookieName } from "./session-cookie";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const sessions = new Map<string, Promise<string>>();
beforeEach(() => {
  freshBrowser();
  sessions.clear();
});

const t = ru.identity.registration.errors;

/**
 * Регистрация от лица вошедшего человека: у каждого пользователя своя сессия identity (токен запоминается, повтор идёт
 * с той же сессией), вызов идёт в своём «браузере» (asBrowser) — одновременные регистрации разных людей не путают токены.
 */
async function registerExecutor(user: Parameters<typeof register>[0], input: ExecutorRegistrationInput) {
  return inSession(user, () => register(user, input));
}

/** Действие от лица вошедшего человека: в его сессии identity и в его «браузере» (см. registerExecutor). */
async function inSession<T>(user: { id: string }, call: () => Promise<T>): Promise<T> {
  let signedIn = sessions.get(user.id);
  if (signedIn === undefined) {
    signedIn = signInAs(user);
    sessions.set(user.id, signedIn);
  }
  const token = await signedIn;
  return asBrowser({ [sessionCookieName()]: token }, call);
}

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);

const selfEmployed: ExecutorRegistrationInput = {
  legalForm: "SELF_EMPLOYED",
  legalName: "Ерлан Жумабаев",
  // ИП и самозанятый номер не вводят (Ruling U): схема анкеты отдаёт пустой, identity берёт ИИН личности.
  binIin: "",
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

/** Заказчик с ИИН из знакомства (№26): личность с этим ИИН есть в identity. */
async function clientWithIin(iin = IIN) {
  const user = await makeClient();
  await db.user.update({ where: { id: user.id }, data: { iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) } });
  return { ...user, iinLast4: last4(iin) };
}

/** Вошёл по SMS: ни ФИО, ни ИИН в записи пользователя нет. */
async function smsUser() {
  const user = await makeClient();
  await db.user.update({ where: { id: user.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  return { ...user, fullName: null, iinLast4: null };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e;
}

const codeOf = async (p: Promise<unknown>) => (await failure(p)).code;
const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method);
const profileOf = (profileId: string) => db.executorProfile.findUniqueOrThrow({ where: { id: profileId } });

/** Профиль после регистрации — проекция стороны identity: ни шифртекстов, ни HMAC в старой базе. */
async function expectNoPiiColumns(profileId: string) {
  expect(await profileOf(profileId)).toMatchObject({ binIinEnc: null, binIinHash: null, signerIinEnc: null, signerIinHash: null, payoutIbanEnc: null });
}

describe("registerExecutor", () => {
  it("создаёт профиль PENDING из ответа identity, без шифртекстов; добавляет роль исполнителя и уведомляет операторов", async () => {
    const [op1, op2] = [await makeOperator(), await makeOperator()];
    const user = await clientWithIin();

    const { profileId } = await registerExecutor(user, { ...selfEmployed, district: "Есильский район", streetAddress: "ул. Сыганак, 10" });

    const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId }, include: { user: true } });
    expect(profile).toMatchObject({
      district: "Есильский район",
      streetAddress: "ул. Сыганак, 10",
      userId: user.id,
      status: "PENDING",
      segment: null,
      legalForm: "SELF_EMPLOYED",
      legalName: "Ерлан Жумабаев",
      binIinLast4: IIN.slice(-4),
      signerFullName: "Ерлан Жумабаев",
      payoutIbanLast4: null,
      kycStatus: "PENDING",
      city: "Астана",
      yearsExperience: 7,
    });
    await expectNoPiiColumns(profileId);
    expect(identityFake.partyNumbersOf(user.id)).toEqual({ binIin: IIN, signerIin: "", payoutIban: "" });
    // Роль добавлена к выданным, заказчик остаётся заказчиком (ADR-004); активную роль переключает экран.
    expect(profile.user.roles).toEqual(["CLIENT", "EXECUTOR"]);

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.registered" } });
    expect(audit).toMatchObject({ actorId: user.id, scope: `executor:${profileId}`, entityType: "executor", entityId: profileId });
    expect(JSON.stringify([audit.before, audit.after, audit.meta])).not.toContain(IIN);

    const notes = await db.notification.findMany({ where: { kind: "registration.pending" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([op1.id, op2.id].sort());
    expect(notes[0].link).toBe(`/operator/executors/${profileId}`);
  });

  it("порядок: GrantRole, потом RegisterParty; ключи случайные, реквизиты — без ИИН у ИП и самозанятого", async () => {
    const user = await clientWithIin();

    await registerExecutor(user, selfEmployed);

    const order = identityFake.calls.map((c) => c.method).filter((m) => m === "grantRole" || m === "registerParty");
    expect(order).toEqual(["grantRole", "registerParty"]);
    const uuid = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(callsOf("grantRole")[0].request).toMatchObject({ role: 2, idempotencyKey: uuid });
    expect(callsOf("registerParty")[0].request).toMatchObject({
      legalForm: LegalForm.SELF_EMPLOYED,
      legalName: "Ерлан Жумабаев",
      binIin: "",
      signerFullName: "Ерлан Жумабаев",
      signerIin: "",
      idempotencyKey: uuid,
    });
  });

  it("RegisterParty оборвался после записи: повтор с тем же ключом даёт тот же ответ, профиль создан", async () => {
    // Роль уже выдана (прежняя попытка): первый изменяющий вызов — RegisterParty.
    const client = await clientWithIin();
    await db.user.update({ where: { id: client.id }, data: { roles: ["CLIENT", "EXECUTOR"] } });
    const user = { ...client, roles: ["CLIENT" as const, "EXECUTOR" as const] };
    await inSession(user, async () => undefined);
    identityFake.failNextAfterEffect();

    const { profileId } = await registerExecutor(user, too);

    const calls = callsOf("registerParty");
    expect(calls).toHaveLength(2);
    expect((calls[1].request as { idempotencyKey: string }).idempotencyKey).toBe((calls[0].request as { idempotencyKey: string }).idempotencyKey);
    expect((await profileOf(profileId)).binIinLast4).toBe(BIN.slice(-4));
  });

  it("отказ RegisterParty после выдачи роли: профиль не создан, повтор с другими реквизитами проходит, роль выдана один раз", async () => {
    await registerExecutor(await clientWithIin(testIin("930114", 3, 24)), too);
    const user = await clientWithIin();

    // Тот же БИН у другого номера: роль уже выдана, identity отказал — до транзакции старой базы дело не дошло.
    expect(await codeOf(registerExecutor(user, too))).toBe("CONFLICT");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
    expect(await db.executorProfile.count({ where: { userId: user.id } })).toBe(0);

    const { profileId } = await registerExecutor(user, { ...too, binIin: testBin("2101", 17) });

    expect((await profileOf(profileId)).userId).toBe(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
    // Три вызова: чужая регистрация и две попытки этого человека (в тесте `user` устарел, повтор снова зовёт GrantRole: granted=false).
    expect(callsOf("grantRole")).toHaveLength(3);
    expect((await identityFake.client.authenticate({ sessionToken: await sessions.get(user.id)! })).user?.roles).toEqual([1, 2]);
  });

  it("повтор из новой сессии: роль уже есть в проекции, GrantRole не вызывается", async () => {
    await registerExecutor(await clientWithIin(testIin("930114", 3, 24)), too);
    const user = await clientWithIin();
    expect(await codeOf(registerExecutor(user, too))).toBe("CONFLICT");

    freshBrowser();
    await signInAs(user);
    const fresh = (await getCurrentUser())!;
    expect(fresh.roles).toEqual(["CLIENT", "EXECUTOR"]);
    const grantsBefore = callsOf("grantRole").length;

    await register(fresh, { ...too, binIin: testBin("2101", 17) });

    expect(callsOf("grantRole")).toHaveLength(grantsBefore);
    expect(await db.executorProfile.count({ where: { userId: user.id } })).toBe(1);
  });

  it("без сессии — UNAUTHENTICATED, ничего не создано", async () => {
    const user = await clientWithIin();
    expect(await codeOf(register(user, selfEmployed))).toBe("UNAUTHENTICATED");
    expect(await db.executorProfile.count()).toBe(0);
  });

  it("ТОО регистрируется по БИН: в профиле — последние 4 цифры, сам БИН — только в identity", async () => {
    const user = await clientWithIin();
    const { profileId } = await registerExecutor(user, too);
    expect(await profileOf(profileId)).toMatchObject({ legalForm: "TOO", binIinLast4: BIN.slice(-4) });
    await expectNoPiiColumns(profileId);
    expect(identityFake.partyNumbersOf(user.id)?.binIin).toBe(BIN);
  });

  it("профиль на проверке или подтверждён — CONFLICT «уже подали» без вызова identity, реквизиты не меняются", async () => {
    const user = await clientWithIin();
    const { profileId } = await registerExecutor(user, too);
    const calls = callsOf("registerParty").length;

    const changed = { ...too, legalName: "ТОО «Шебер»", binIin: testBin("2101", 19) };
    expect(await failure(registerExecutor({ ...user, role: "EXECUTOR" }, changed))).toMatchObject({ code: "CONFLICT", message: t.alreadyRegistered });
    await reviewExecutorRegistration(await makeOperator(), profileId, { approve: true, segment: "COMFORT" });
    expect(await failure(registerExecutor({ ...user, role: "EXECUTOR" }, changed))).toMatchObject({ code: "CONFLICT", message: t.alreadyRegistered });

    expect(callsOf("registerParty")).toHaveLength(calls);
    expect(identityFake.partyNumbersOf(user.id)?.binIin).toBe(BIN);
    expect(await profileOf(profileId)).toMatchObject({ legalName: "ТОО «Ағаш»", binIinLast4: BIN.slice(-4) });
  });

  it("двойная отправка формы создаёт один профиль, второй ответ — понятный конфликт", async () => {
    const user = await clientWithIin();

    const results = await Promise.allSettled([registerExecutor(user, selfEmployed), registerExecutor(user, selfEmployed)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(AppError);
    expect((rejected?.reason as AppError).code).toBe("CONFLICT");
    expect(await db.executorProfile.count()).toBe(1);
  });

  it("тот же БИН с другого номера — конфликт с текстом о реквизитах, в том числе при одновременной отправке", async () => {
    await registerExecutor(await clientWithIin(testIin("930114", 3, 24)), too);
    // iin_taken на БИН стороны — не текст про ИИН личности (тот — у шага «ФИО и ИИН»).
    expect(await failure(registerExecutor(await clientWithIin(), too))).toMatchObject({ code: "CONFLICT", message: t.binIinTaken });
    expect(t.binIinTaken).not.toBe(ru.identity.clientIdentity.iinTaken);

    const other = { ...too, binIin: testBin("2101", 18) };
    const [a, b] = [await clientWithIin(testIin("850101", 3, 31)), await clientWithIin(testIin("850101", 3, 32))];
    const codes = await Promise.all([registerExecutor(a, other), registerExecutor(b, other)].map((p) => codeOf(p).catch(() => "OK")));
    expect(codes.sort()).toEqual(["CONFLICT", "OK"]);
    expect(await db.executorProfile.count()).toBe(2);
  });

  it("перебор ИИН/БИН упирается в лимит web: не больше 5 попыток регистрации в час, шестая не доходит до identity", async () => {
    await registerExecutor(await clientWithIin(testIin("930114", 3, 24)), too);
    const prober = await clientWithIin();
    for (let i = 0; i < 5; i++) expect(await codeOf(registerExecutor(prober, too))).toBe("CONFLICT");
    const before = callsOf("registerParty").length;
    expect(await codeOf(registerExecutor(prober, too))).toBe("RATE_LIMITED");
    expect(callsOf("registerParty")).toHaveLength(before);
  });

  it("заказчик с заявками становится исполнителем на том же номере: роль CLIENT и заявки остаются", async () => {
    const user = await clientWithIin();
    const request = await db.request.create({ data: { clientId: user.id, mode: "TENDER" } });

    await registerExecutor(user, selfEmployed);

    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "CLIENT", roles: ["CLIENT", "EXECUTOR"] });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ clientId: user.id });
  });

  it("оператор не может зарегистрироваться исполнителем: identity не вызывается", async () => {
    expect(await codeOf(registerExecutor(await makeOperator(), selfEmployed))).toBe("FORBIDDEN");
    expect(callsOf("registerParty")).toHaveLength(0);
  });
});

describe("повторная подача после отказа (Ruling T)", () => {
  /** Исполнитель подал анкету, оператор отказал. */
  async function rejected(input: ExecutorRegistrationInput) {
    const u = await clientWithIin();
    const { profileId } = await registerExecutor(u, input);
    await reviewExecutorRegistration(await makeOperator(), profileId, { approve: false, reason: "Проверьте данные" });
    return { user: { ...u, role: "EXECUTOR" as const }, profileId };
  }

  it("те же реквизиты: профиль снова PENDING с новым адресом, роль не дублируется", async () => {
    const { user, profileId } = await rejected(selfEmployed);

    const again = await registerExecutor(user, { ...selfEmployed, district: "Алматинский район", yearsExperience: 9 });

    expect(again.profileId).toBe(profileId);
    expect(await profileOf(profileId)).toMatchObject({ status: "PENDING", rejectReason: null, reviewedAt: null, district: "Алматинский район", yearsExperience: 9 });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
  });

  it("после отказа можно исправить данные и подать снова", async () => {
    const { user, profileId } = await rejected(selfEmployed);

    const again = await registerExecutor(user, { ...selfEmployed, legalName: "Жумабаев Ерлан" });

    expect(again.profileId).toBe(profileId);
    expect(await profileOf(profileId)).toMatchObject({ status: "PENDING", rejectReason: null, legalName: "Жумабаев Ерлан", signerFullName: "Жумабаев Ерлан" });
    expect(identityFake.auditEvents.filter((e) => e.userId === user.id && e.action.startsWith("party.")).map((e) => e.action)).toEqual([
      "party.registered",
      "party.replaced",
    ]);
  });

  it("ТОО: новый директор и БИН заменяют прежние в identity и в профиле", async () => {
    const { user, profileId } = await rejected(too);

    const newDirector = testIin("820304", 4, 42);
    const newBin = testBin("2101", 20);
    await registerExecutor(user, { ...too, binIin: newBin, signer: { fullName: "Ахметова Сауле", iin: newDirector } });

    expect(await profileOf(profileId)).toMatchObject({ status: "PENDING", signerFullName: "Ахметова Сауле", binIinLast4: newBin.slice(-4) });
    await expectNoPiiColumns(profileId);
    expect(identityFake.partyNumbersOf(user.id)).toMatchObject({ binIin: newBin, signerIin: newDirector });
  });

  it("смена ТОО на ИП: ИИН прежнего директора стирается, номер — ИИН личности", async () => {
    const { user, profileId } = await rejected(too);

    await registerExecutor(user, ip);

    expect(await profileOf(profileId)).toMatchObject({ legalForm: "IP", signerFullName: "Жумабаев Ерлан", binIinLast4: IIN.slice(-4) });
    expect(identityFake.partyNumbersOf(user.id)).toMatchObject({ binIin: IIN, signerIin: "" });
  });

  it("KYC уже на проверке в identity — другие реквизиты не принимаются: CONFLICT с текстом, профиль остаётся отклонённым", async () => {
    const { user, profileId } = await rejected(too);
    identityFake.setKycStatus(user.id, KycStatus.PENDING);

    const e = await failure(registerExecutor(user, { ...too, legalName: "ТОО «Шебер»" }));

    expect(e).toMatchObject({ code: "CONFLICT", message: t.partyExists });
    expect(await profileOf(profileId)).toMatchObject({ status: "REJECTED", legalName: "ТОО «Ағаш»" });
  });
});

describe("подписант договора — свойство профиля, а не аккаунта", () => {
  // Замер и согласие на договор — шаги сценариев до договора (флаг preContractFlows).
  withPreContractFlows();

  const accountOf = (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId } });

  it("ТОО: ФИО директора — в профиле, ИИН директора — только в identity; аккаунт не меняется", async () => {
    const user = await smsUser();
    const { profileId } = await registerExecutor(user, too);

    expect(await profileOf(profileId)).toMatchObject({ signerFullName: "Тулегенов Бауыржан" });
    await expectNoPiiColumns(profileId);
    expect(identityFake.partyNumbersOf(user.id)?.signerIin).toBe(DIRECTOR_IIN);
    expect(await accountOf(user.id)).toMatchObject({ fullName: null, iinHash: null, iinEnc: null, iinLast4: null });
    const audit = await db.auditEvent.findMany({ where: { actorId: user.id } });
    expect(JSON.stringify(audit.map((a) => [a.before, a.after, a.meta]))).not.toContain(DIRECTOR_IIN);
  });

  it("ИП и самозанятый: подписывает владелец — ФИО в профиле, отдельного ИИН подписанта нет", async () => {
    const a = await clientWithIin();
    expect(await profileOf((await registerExecutor(a, ip)).profileId)).toMatchObject({ signerFullName: "Жумабаев Ерлан" });
    expect(identityFake.partyNumbersOf(a.id)?.signerIin).toBe("");
    const b = await clientWithIin(testIin("930114", 3, 24));
    expect(await profileOf((await registerExecutor(b, selfEmployed)).profileId)).toMatchObject({ signerFullName: "Ерлан Жумабаев" });
  });

  it("один директор у двух ТОО: оба регистрируются", async () => {
    const first = await smsUser();
    await registerExecutor(first, too);
    const second = await smsUser();
    await registerExecutor(second, { ...too, legalName: "ТОО «Шебер»", binIin: testBin("2101", 17) });
    expect([identityFake.partyNumbersOf(first.id)?.signerIin, identityFake.partyNumbersOf(second.id)?.signerIin]).toEqual([DIRECTOR_IIN, DIRECTOR_IIN]);
  });

  it("ИП берёт ИИН личности: номер identity не передаётся, в профиле — последние 4 цифры ИИН аккаунта (№26, №28, Ruling U)", async () => {
    const me = await clientWithIin();

    const { profileId } = await registerExecutor(me, ip);

    expect(await profileOf(profileId)).toMatchObject({ userId: me.id, binIinLast4: last4(IIN), status: "PENDING" });
    expect(callsOf("registerParty")[0].request).toMatchObject({ binIin: "" });
    expect(identityFake.partyNumbersOf(me.id)?.binIin).toBe(IIN);
    expect(await accountOf(me.id)).toMatchObject({ iinLast4: last4(IIN), roles: ["CLIENT", "EXECUTOR"] });
  });

  it("ИП без ИИН в аккаунте (person_missing) — ошибка у поля ИИН с текстом из ru", async () => {
    const e = await failure(registerExecutor(await smsUser(), ip));
    expect(e).toMatchObject({ code: "VALIDATION", message: t.personMissing, details: { fieldErrors: { binIin: [t.personMissing] } } });
    expect(await db.executorProfile.count()).toBe(0);
  });

  it("директор ТОО с ИИН заказчика в том же аккаунте регистрирует ТОО (№28)", async () => {
    const me = await clientWithIin(DIRECTOR_IIN);
    await registerExecutor(me, too);
    expect(identityFake.partyNumbersOf(me.id)?.signerIin).toBe(DIRECTOR_IIN);
  });

  it("исполнитель-ИП, ставший заказчиком, договор подписывает тем же ИИН; чужой аккаунт с этим ИИН указать не может", async () => {
    const me = await clientWithIin();
    await registerExecutor(me, ip);
    const m = await makeMeasured(me);

    await inSession(me, () => agreeToContract(me, { requestId: m.requestId, identity: { fullName: "Жумабаев Ерлан", iin: IIN } }));
    expect(await accountOf(me.id)).toMatchObject({ iinLast4: last4(IIN) });

    // Один ИИН заказчика — один аккаунт: для чужих правило остаётся.
    const other = await smsUser();
    const m2 = await makeMeasured(other);
    expect(await codeOf(inSession(other, () => agreeToContract(other, { requestId: m2.requestId, identity: { fullName: "Жумабаев Ерлан", iin: IIN } })))).toBe("CONFLICT");
  });

  it("чужой ИИН в анкете ТОО не мешает настоящему владельцу ИИН указать его перед договором", async () => {
    // Кто-то вписал в анкету ТОО ИИН заказчика как ИИН «директора».
    await registerExecutor(await smsUser(), too);
    const owner = await smsUser();
    const m = await makeMeasured(owner);

    await inSession(owner, () => agreeToContract(owner, { requestId: m.requestId, identity: { fullName: "Тулегенов Бауыржан", iin: DIRECTOR_IIN } }));
    expect(await accountOf(owner.id)).toMatchObject({ iinLast4: last4(DIRECTOR_IIN) });
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
