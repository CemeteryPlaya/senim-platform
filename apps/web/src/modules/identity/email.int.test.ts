import { Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { actingAs, makeClient, makeExecutor, makeOperator, makeUser } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { updateContacts } from "./contacts-profile";
import { projectSeedPerson } from "./demo";
import { needsEmail, requestEmailCode, verifyEmailCode } from "./email";
import { getCurrentUser, type CurrentUser } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.login.email.errors;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDRESS = "aigerim@example.kz";

beforeEach(() => freshBrowser());
afterEach(() => vi.restoreAllMocks());

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e;
}

const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method).map((c) => c.request as Record<string, unknown>);
const row = (id: string) => db.user.findUniqueOrThrow({ where: { id }, select: { email: true, emailVerifiedAt: true } });

/** Вошедший заказчик фабрики — каким его видит сервер после входа (getCurrentUser). */
async function signedIn(make: () => Promise<{ id: string }> = () => makeClient()): Promise<CurrentUser> {
  await signInAs(await make());
  return (await getCurrentUser())!;
}

/** Запрос кода, который выслан (не «уже подтверждён»). */
async function sentFor(user: CurrentUser, email = ADDRESS) {
  const sent = await requestEmailCode(user, email);
  if (sent.alreadyVerified) throw new Error("ожидался высланный код, а адрес уже подтверждён");
  return sent;
}

async function codeFor(user: CurrentUser, email = ADDRESS): Promise<string> {
  const { demoCode } = await sentFor(user, email);
  if (!demoCode) throw new Error("подделка с мок-провайдером почты возвращает код");
  return demoCode;
}

/** Другой код из 6 цифр, заведомо неверный. */
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe("requestEmailCode", () => {
  it("возвращает срок (10 минут) и код из 6 цифр; адрес уходит без пробелов по краям, ключ — случайный UUID", async () => {
    const user = await signedIn();
    const before = Date.now();
    const sent = await sentFor(user, `  ${ADDRESS} `);

    expect(sent.demoCode).toMatch(/^\d{6}$/);
    expect(sent.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    expect(sent.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    const [call] = callsOf("requestEmailCode");
    expect(call).toMatchObject({ email: ADDRESS });
    expect(call.idempotencyKey).toMatch(UUID);
    expect(call.sessionToken).toEqual(expect.any(String));
  });

  it("адрес до подтверждения не записан ни в identity, ни в проекцию", async () => {
    const user = await signedIn();
    await requestEmailCode(user, ADDRESS);
    expect(identityFake.personOf(user.id)).toMatchObject({ email: "", emailVerified: false });
    expect(await row(user.id)).toEqual({ email: null, emailVerifiedAt: null });
  });

  it("identity не вернул код (провайдер писем — не мок) — demoCode null", async () => {
    const user = await signedIn();
    identityFake.emailProviderMock = false;
    expect((await sentFor(user)).demoCode).toBeNull();
  });

  it("неверный адрес — VALIDATION у поля email без вызова identity", async () => {
    const user = await signedIn();
    for (const bad of ["", "   ", "не почта", "a@b", `${"a".repeat(250)}@example.kz`]) {
      const err = await errorOf(requestEmailCode(user, bad));
      expect([err.code, err.message, err.details]).toEqual(["VALIDATION", t.invalid, { fieldErrors: { email: [t.invalid] } }]);
    }
    expect(callsOf("requestEmailCode")).toHaveLength(0);
  });

  it("отказ identity email_invalid — текст нового экрана у поля email (не текст прежнего экрана контактов)", async () => {
    const user = await signedIn();
    identityFake.failNextWithCode("email_invalid", {}, Code.InvalidArgument);
    const err = await errorOf(requestEmailCode(user, ADDRESS));
    expect([err.code, err.message, err.details]).toEqual(["VALIDATION", t.invalid, { fieldErrors: { email: [t.invalid] } }]);
  });

  it("в ту же минуту на тот же адрес — «код уже отправлен» (своя причина), на другой — «слишком часто»", async () => {
    const user = await signedIn();
    await requestEmailCode(user, ADDRESS);
    const same = await errorOf(requestEmailCode(user, ` ${ADDRESS.toUpperCase()}`));
    expect([same.code, same.message, same.details]).toEqual(["RATE_LIMITED", t.alreadySent, { reason: "EMAIL_CODE_ALREADY_SENT" }]);
    const other = await errorOf(requestEmailCode(user, "other@example.kz"));
    expect([other.code, other.message, other.details]).toEqual(["RATE_LIMITED", t.tooOften, { reason: "CODE_TOO_OFTEN" }]);
  });

  it("второй код в ту же минуту на другой адрес — «слишком часто»; шестой за час — «слишком много»", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    await requestEmailCode(user, ADDRESS);
    const often = await errorOf(requestEmailCode(user, "other@example.kz"));
    expect([often.code, often.message]).toEqual(["RATE_LIMITED", t.tooOften]);

    // Отказ «слишком часто» до часового счётчика не дошёл (как в Go: лимиты по очереди, первый отказ — конец).
    for (let i = 0; i < 4; i++) {
      now += 61_000;
      await requestEmailCode(user, ADDRESS);
    }
    now += 61_000;
    const many = await errorOf(requestEmailCode(user, ADDRESS));
    expect([many.code, many.message]).toEqual(["RATE_LIMITED", t.tooMany]);
  });

  it("ответ потерян — один повтор с тем же ключом: второго кода нет, повтор возвращает тот же срок", async () => {
    const user = await signedIn();
    identityFake.failNextAfterEffect();
    const sent = await sentFor(user);

    const [first, second] = callsOf("requestEmailCode");
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(sent.expiresAt).toEqual(expect.any(Date));
    // Сохранённый ответ кода не раскрывает (как в Go): повтор возвращает его пустым.
    expect(sent.demoCode).toBeNull();
  });

  it("тот же адрес уже подтверждён — { alreadyVerified: true } без кода и без траты лимита; другой адрес — код", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    now += 61_000;
    const before = identityFake.auditEvents.length;

    expect(await requestEmailCode(user, ` ${ADDRESS.toUpperCase()} `)).toEqual({ alreadyVerified: true });
    expect(identityFake.auditEvents).toHaveLength(before);
    // Лимит «раз в минуту» не потрачен: другой адрес сразу получает код.
    expect((await sentFor(user, "other@example.kz")).demoCode).toMatch(/^\d{6}$/);
  });

  it("уже подтверждён в identity, а проекция отстала — проекция обновляется, шаг почты больше не нужен", async () => {
    const user = await signedIn();
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    const stale = (await getCurrentUser())!;
    expect(needsEmail(stale)).toBe(true);

    expect(await requestEmailCode(stale, ADDRESS)).toEqual({ alreadyVerified: true });

    expect((await row(user.id)).emailVerifiedAt).toBeInstanceOf(Date);
    expect(needsEmail((await getCurrentUser())!)).toBe(false);
  });

  it("оператору почта не нужна — FORBIDDEN без вызова identity", async () => {
    const operator = await signedIn(() => makeOperator());
    expect((await errorOf(requestEmailCode(operator, ADDRESS))).code).toBe("FORBIDDEN");
    expect(callsOf("requestEmailCode")).toHaveLength(0);
  });

  it("identity отказал по роли (роль сменилась в другой вкладке) — FORBIDDEN", async () => {
    const user = await signedIn();
    identityFake.failNextWithCode("role_forbidden");
    expect((await errorOf(requestEmailCode(user, ADDRESS))).code).toBe("FORBIDDEN");
  });
});

describe("verifyEmailCode", () => {
  it("верный код: адрес подтверждён в identity, в проекции и в CurrentUser", async () => {
    const user = await signedIn();
    expect(user.emailVerified).toBe(false);
    const code = await codeFor(user);

    await verifyEmailCode(user, ` ${code} `, ADDRESS);

    expect(identityFake.personOf(user.id)).toMatchObject({ email: ADDRESS, emailVerified: true });
    const saved = await row(user.id);
    expect(saved.email).toBe(ADDRESS);
    expect(saved.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await getCurrentUser())!.emailVerified).toBe(true);
    const [call] = callsOf("verifyEmailCode");
    expect(call.idempotencyKey).toMatch(UUID);
    // Аудит identity — без адреса.
    const events = identityFake.auditEvents.filter((e) => e.userId === user.id);
    expect(events.map((e) => e.action)).toEqual(["user.email_changed", "user.email_verified"]);
    expect(JSON.stringify(events)).not.toContain("example.kz");
  });

  it("подтверждается ровно показанный адрес: другой адрес — «код устарел» у поля, попытка не тратится; тот же в другом регистре — успех", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    const err = await errorOf(verifyEmailCode(user, code, "other@example.kz"));
    expect([err.code, err.message, err.details?.["fieldErrors"]]).toEqual(["VALIDATION", t.expired, { code: [t.expired] }]);
    expect(callsOf("verifyEmailCode").at(-1)).toMatchObject({ email: "other@example.kz" });
    expect(identityFake.personOf(user.id)).toMatchObject({ email: "", emailVerified: false });

    await verifyEmailCode(user, code, `  ${ADDRESS.toUpperCase()} `);
    expect(callsOf("verifyEmailCode").at(-1)).toMatchObject({ email: ADDRESS });
    expect(identityFake.personOf(user.id)).toMatchObject({ email: ADDRESS, emailVerified: true });
  });

  it("неверный адрес на экране — ошибка у поля email без вызова identity", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    const err = await errorOf(verifyEmailCode(user, code, "erlan@"));
    expect([err.code, err.details?.["fieldErrors"]]).toEqual(["VALIDATION", { email: [t.invalid] }]);
    expect(callsOf("verifyEmailCode")).toHaveLength(0);
  });

  it("неверный код — VALIDATION «Неверный код. Осталось попыток: 4»; адрес не подтверждён", async () => {
    const user = await signedIn();
    const code = await codeFor(user);

    const err = await errorOf(verifyEmailCode(user, wrong(code), ADDRESS));

    expect([err.code, err.message]).toEqual(["VALIDATION", t.wrongCode(4)]);
    expect(t.wrongCode(4)).toBe("Неверный код. Осталось попыток: 4");
    expect(await row(user.id)).toEqual({ email: null, emailVerifiedAt: null });
    expect((await getCurrentUser())!.emailVerified).toBe(false);
  });

  it("пятый неверный код — попытки закончились; верный после этого тоже не принимается", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    for (let left = 4; left >= 1; left--) expect((await errorOf(verifyEmailCode(user, wrong(code), ADDRESS))).message).toBe(t.wrongCode(left));

    const fifth = await errorOf(verifyEmailCode(user, wrong(code), ADDRESS));
    expect([fifth.code, fifth.message]).toEqual(["RATE_LIMITED", t.attemptsExhausted]);
    expect((await errorOf(verifyEmailCode(user, code, ADDRESS))).message).toBe(t.attemptsExhausted);
    expect(identityFake.personOf(user.id).emailVerified).toBe(false);
  });

  it("код истёк (10 минут) или не запрашивался — «Код устарел»", async () => {
    const user = await signedIn();
    expect((await errorOf(verifyEmailCode(user, "123456", ADDRESS))).message).toBe(t.expired);

    let now = Date.now();
    identityFake.now = () => new Date(now);
    const code = await codeFor(user);
    now += 10 * 60_000 + 1;
    const err = await errorOf(verifyEmailCode(user, code, ADDRESS));
    expect([err.code, err.message]).toEqual(["VALIDATION", t.expired]);
  });

  it("новый код гасит прежний", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    const old = await codeFor(user, "old@example.kz");
    now += 61_000;
    const fresh = await codeFor(user);
    if (old !== fresh) expect((await errorOf(verifyEmailCode(user, old, ADDRESS))).message).toBe(t.wrongCode(4));
    await verifyEmailCode(user, fresh, ADDRESS);
    expect(identityFake.personOf(user.id)).toMatchObject({ email: ADDRESS, emailVerified: true });
  });

  it("ответ потерян — повтор с тем же ключом даёт тот же ответ, проекция подтверждена", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    identityFake.failNextAfterEffect();

    await verifyEmailCode(user, code, ADDRESS);

    const [first, second] = callsOf("verifyEmailCode");
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect((await row(user.id)).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("ввод очищается до цифр: «12 34-56» уходит как 123456", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    await verifyEmailCode(user, `${code.slice(0, 2)} ${code.slice(2, 4)}-${code.slice(4)}`, ADDRESS);
    expect(callsOf("verifyEmailCode")[0]).toMatchObject({ code });
    expect(identityFake.personOf(user.id).emailVerified).toBe(true);
  });

  it("не 6 цифр после очистки — ошибка поля code без вызова identity, попытка не тратится", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
      const err = await errorOf(verifyEmailCode(user, bad, ADDRESS));
      expect([err.code, err.message, err.details]).toEqual(["VALIDATION", t.codeFormat, { fieldErrors: { code: [t.codeFormat] } }]);
    }
    expect(callsOf("verifyEmailCode")).toHaveLength(0);
    // Все 5 попыток на месте: четвёртый неверный ещё оставляет одну.
    for (let left = 4; left >= 1; left--) expect((await errorOf(verifyEmailCode(user, wrong(code), ADDRESS))).message).toBe(t.wrongCode(left));
  });

  it("больше 20 проверок в сутки — «слишком много попыток»", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    for (let i = 0; i < 4; i++) {
      const code = await codeFor(user);
      for (let n = 0; n < 5; n++) await errorOf(verifyEmailCode(user, wrong(code), ADDRESS));
      now += 61_000;
    }
    const code = await codeFor(user);
    const err = await errorOf(verifyEmailCode(user, code, ADDRESS));
    expect([err.code, err.message]).toEqual(["RATE_LIMITED", t.tooMany]);
    expect(identityFake.personOf(user.id).emailVerified).toBe(false);
  });

  it("повторное подтверждение того же адреса после смены и возврата — проекция подтверждена заново", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    await updateContacts(user, { instagram: "", email: "other@example.kz" });
    expect((await row(user.id)).emailVerifiedAt).toBeNull();
    now += 61_000;
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    expect(await row(user.id)).toMatchObject({ email: ADDRESS, emailVerifiedAt: expect.any(Date) });
  });

  it("отказы по коду — у поля code; лимит проверок — ошибка формы", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    expect((await errorOf(verifyEmailCode(user, wrong(code), ADDRESS))).details).toEqual({ fieldErrors: { code: [t.wrongCode(4)] } });
    identityFake.failNextWithCode("email_code_too_many");
    const many = await errorOf(verifyEmailCode(user, code, ADDRESS));
    expect([many.code, many.message, many.details]).toEqual(["RATE_LIMITED", t.tooMany, undefined]);
  });

  it("две вкладки: второй ввод того же кода после успеха в первой — тоже успех (identity: код погашен, почта подтверждена)", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    await verifyEmailCode(user, code, ADDRESS); // первая вкладка
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } }); // вторая ещё не знает о подтверждении

    await expect(verifyEmailCode(user, code, ADDRESS)).resolves.toBeUndefined(); // `user` — снимок до подтверждения

    expect(callsOf("getProfile")).toHaveLength(1);
    expect((await row(user.id)).emailVerifiedAt).toBeInstanceOf(Date);
    expect((await getCurrentUser())!.emailVerified).toBe(true);
  });

  it("«код устарел» без подтверждённой почты — отказ у поля code (профиль перечитан); у уже подтверждённого — отказ без перечитывания", async () => {
    const user = await signedIn();
    let now = Date.now();
    identityFake.now = () => new Date(now);
    const code = await codeFor(user);
    now += 10 * 60_000 + 1;
    const err = await errorOf(verifyEmailCode(user, code, ADDRESS));
    expect([err.code, err.details]).toEqual(["VALIDATION", { fieldErrors: { code: [t.expired] }, reason: "EMAIL_CODE_EXPIRED" }]);
    expect(callsOf("getProfile")).toHaveLength(1);

    // Подтверждённый человек подтверждает новый адрес: прежнее подтверждение — не успех нового.
    now += 61_000;
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    const verified = (await getCurrentUser())!;
    now += 61_000;
    const fresh = await codeFor(verified, "new@example.kz");
    now += 10 * 60_000 + 1;
    expect((await errorOf(verifyEmailCode(verified, fresh, "new@example.kz"))).message).toBe(t.expired);
    expect(callsOf("getProfile")).toHaveLength(1);
    expect(identityFake.personOf(user.id).email).toBe(ADDRESS);
  });

  it("сбой GetProfile после «уже подтверждена» — «сервис недоступен», а не «подтверждена»: иначе шаг почты зациклился бы", async () => {
    const user = await signedIn();
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    identityFake.now = () => new Date(Date.now() + 61_000);
    identityFake.passNext(); // requestEmailCode → email_already_verified
    identityFake.failNextUnavailable(); // getProfile
    expect((await errorOf(requestEmailCode(user, ADDRESS))).code).toBe("UNAVAILABLE");
    expect((await row(user.id)).emailVerifiedAt).toBeNull();
  });

  it("оператору — FORBIDDEN без вызова identity", async () => {
    const operator = await signedIn(() => makeOperator());
    expect((await errorOf(verifyEmailCode(operator, "123456", ADDRESS))).code).toBe("FORBIDDEN");
    expect(callsOf("verifyEmailCode")).toHaveLength(0);
  });
});

describe("проекция почты и прежний экран контактов (updateContacts)", () => {
  it("другой адрес через старый экран снимает подтверждение в identity и в проекции", async () => {
    const user = await signedIn();
    await verifyEmailCode(user, await codeFor(user), ADDRESS);

    await updateContacts(user, { instagram: "", email: "other@example.kz" });

    expect(identityFake.personOf(user.id)).toMatchObject({ email: "other@example.kz", emailVerified: false });
    expect(await row(user.id)).toEqual({ email: "other@example.kz", emailVerifiedAt: null });
    expect((await getCurrentUser())!.emailVerified).toBe(false);
  });

  it("тот же адрес (в другом регистре) подтверждение оставляет; пустой — снимает", async () => {
    const user = await signedIn();
    await verifyEmailCode(user, await codeFor(user), ADDRESS);
    const verifiedAt = (await row(user.id)).emailVerifiedAt;

    await updateContacts(user, { instagram: "dala", email: ADDRESS.toUpperCase() });
    expect(await row(user.id)).toEqual({ email: ADDRESS, emailVerifiedAt: verifiedAt });
    expect((await getCurrentUser())!.emailVerified).toBe(true);

    await updateContacts(user, { instagram: "dala", email: "" });
    expect(await row(user.id)).toEqual({ email: null, emailVerifiedAt: null });
  });

  it("смена адреса гасит ожидающий код: подтвердить прежнего кандидата нельзя", async () => {
    const user = await signedIn();
    const code = await codeFor(user);
    await updateContacts(user, { instagram: "", email: "other@example.kz" });
    expect((await errorOf(verifyEmailCode(user, code, ADDRESS))).message).toBe(t.expired);
  });

  it("человек сида демо получает подтверждённую почту в проекции (как её отдаёт сид identity)", async () => {
    const user = await makeClient();
    await projectSeedPerson(user.id, { phone: user.phone, role: "CLIENT", roles: ["CLIENT"], isDemo: true, createdAt: new Date(), fullName: "Демо Клиент", email: ADDRESS }, db);
    expect((await row(user.id)).emailVerifiedAt).toBeInstanceOf(Date);

    const other = await makeClient();
    await projectSeedPerson(other.id, { phone: other.phone, role: "CLIENT", roles: ["CLIENT"], isDemo: true, createdAt: new Date(), fullName: "Демо Клиент" }, db);
    expect(await row(other.id)).toEqual({ email: null, emailVerifiedAt: null });
  });
});

describe("needsEmail", () => {
  const base = { roles: ["CLIENT"] as CurrentUser["roles"] };
  it.each([
    ["заказчик без почты", { ...base, role: "CLIENT", emailVerified: false }, true],
    ["заказчик с подтверждённой почтой", { ...base, role: "CLIENT", emailVerified: true }, false],
    ["мастер без подтверждения", { role: "EXECUTOR", roles: ["EXECUTOR"], emailVerified: false }, true],
    ["мастер и заказчик (две роли), не подтверждена", { role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"], emailVerified: false }, true],
    ["две роли, активна роль заказчика, подтверждена", { role: "CLIENT", roles: ["CLIENT", "EXECUTOR"], emailVerified: true }, false],
    ["оператор без почты", { role: "OPERATOR", roles: ["OPERATOR"], emailVerified: false }, false],
    ["замерщик без почты", { role: "MEASURER", roles: ["MEASURER"], emailVerified: false }, false],
  ] as const)("%s → %s", (_, user, expected) => {
    expect(needsEmail({ ...user, roles: [...user.roles] })).toBe(expected);
  });

  it("CurrentUser после входа: заказчик без почты — нужна, оператор — нет", async () => {
    expect(needsEmail(await signedIn())).toBe(true);
    freshBrowser();
    expect(needsEmail(await signedIn(() => makeOperator()))).toBe(false);
  });

  it("человек с двумя ролями подтверждает почту один раз: она общая для обеих ролей", async () => {
    const executor = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    await signInAs(executor);
    const asExecutor = (await getCurrentUser())!;
    expect(needsEmail(asExecutor)).toBe(true);
    await verifyEmailCode(asExecutor, await codeFor(asExecutor), ADDRESS);
    const after = (await getCurrentUser())!;
    expect(needsEmail(after)).toBe(false);
    expect(needsEmail(actingAs(after, "CLIENT"))).toBe(false);
  });

  it("makeUser с ролью замерщика — не сторона сделки, почта не нужна", async () => {
    expect(needsEmail(await makeUser("MEASURER"))).toBe(false);
  });
});
