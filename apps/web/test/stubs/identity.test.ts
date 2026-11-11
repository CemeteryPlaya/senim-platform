import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import { KycStatus, LegalForm, RevealPurpose, Role, SigningSide } from "@/gen/senim/identity/v1/identity_pb";
import { testBin, testIin } from "@/demo/kz-id";
import { totpNow } from "../../e2e/totp";
import { FakeIdentity, FAKE_OTP_CODE } from "./identity";

const token = (n: number) => `${String(n).padStart(2, "0")}${"a".repeat(41)}`;
const PHONE = "+77001234567";

let fake: FakeIdentity;
beforeEach(() => {
  fake = new FakeIdentity();
});

async function rejection(p: Promise<unknown>): Promise<{ code: Code; detail: string | undefined }> {
  try {
    await p;
  } catch (e) {
    const err = ConnectError.from(e);
    return { code: err.code, detail: err.findDetails(ErrorDetailSchema)[0]?.code };
  }
  throw new Error("вызов не отклонён");
}

async function signedIn(n = 1) {
  const user = fake.addUser({ phone: PHONE, roles: [Role.CLIENT, Role.EXECUTOR] });
  fake.signIn(user.id, token(n));
  return user;
}

describe("подделка identity: ключ идемпотентности", () => {
  const mutators: [string, () => Promise<unknown>][] = [
    ["requestOtp", () => fake.client.requestOtp({ phone: PHONE })],
    ["verifyOtp", () => fake.client.verifyOtp({ phone: PHONE, code: FAKE_OTP_CODE, sessionToken: token(1) })],
    ["signOut", () => fake.client.signOut({ sessionToken: token(1) })],
    ["signOutEverywhere", () => fake.client.signOutEverywhere({ sessionToken: token(1) })],
    ["switchRole", () => fake.client.switchRole({ sessionToken: token(1), role: Role.CLIENT })],
    ["grantRole", () => fake.client.grantRole({ sessionToken: token(1), role: Role.CLIENT })],
    ["startDemoSession", () => fake.client.startDemoSession({ userId: "x", sessionToken: token(1) })],
    ["seedUsers", () => fake.client.seedUsers({ users: [] })],
    ["resetDemo", () => fake.client.resetDemo({})],
    ["recordPerson", () => fake.client.recordPerson({ sessionToken: token(1), fullName: "Сапаров Ерлан", iin: "870304300614" })],
    ["updateContacts", () => fake.client.updateContacts({ sessionToken: token(1) })],
  ];

  it.each(mutators)("%s без ключа — InvalidArgument invalid_request", async (_name, call) => {
    expect(await rejection(call())).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
  });

  it("ключ длиннее 128 символов — invalid_request", async () => {
    expect(await rejection(fake.client.resetDemo({ idempotencyKey: "k".repeat(129) }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    await expect(fake.client.resetDemo({ idempotencyKey: "k".repeat(128) })).resolves.toBeDefined();
  });

  it("повтор с тем же ключом и запросом даёт тот же ответ без второго эффекта", async () => {
    const user = fake.addUser({ phone: PHONE });
    fake.signIn(user.id, token(1));
    const req = { sessionToken: token(1), role: Role.EXECUTOR, idempotencyKey: "k1" };

    const first = await fake.client.grantRole(req);
    const again = await fake.client.grantRole(req);

    expect(first.granted).toBe(true);
    expect(again).toBe(first); // без повтора по ключу второй вызов вернул бы granted=false
  });

  it("повтор VerifyOtp с тем же ключом: тот же пользователь, одна сессия, без «код устарел»", async () => {
    await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "r1" });
    const req = { phone: PHONE, code: FAKE_OTP_CODE, sessionToken: token(2), idempotencyKey: "v1" };
    const first = await fake.client.verifyOtp(req);
    const again = await fake.client.verifyOtp(req);

    expect(again).toBe(first);
    expect(fake.sessionCount()).toBe(1);
  });

  it("тот же ключ и метод, но другой запрос — idempotency_key_reused", async () => {
    await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "k" });
    expect(await rejection(fake.client.requestOtp({ phone: "+77001110000", idempotencyKey: "k" }))).toEqual({ code: Code.InvalidArgument, detail: "idempotency_key_reused" });
  });

  it("тот же ключ на другом методе — новый вызов (ключ действует в паре с методом, как в pkg/idem)", async () => {
    await fake.client.resetDemo({ idempotencyKey: "k" });
    await expect(fake.client.requestOtp({ phone: PHONE, idempotencyKey: "k" })).resolves.toBeDefined();
  });

  it("отпечаток запроса — protobuf: явные значения по умолчанию не отличаются от пропущенных", async () => {
    const first = await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "k" });
    const again = await fake.client.requestOtp({ clientIp: "", idempotencyKey: "k", phone: PHONE });
    expect(again).toBe(first);
  });

  it("failNextAfterEffect: действие выполнено, вызов упал Unavailable, повтор вернёт ответ", async () => {
    await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "r" });
    fake.failNextAfterEffect();
    const req = { phone: PHONE, code: FAKE_OTP_CODE, sessionToken: token(3), idempotencyKey: "v" };

    const failure = await rejection(fake.client.verifyOtp(req));

    expect(failure.code).toBe(Code.Unavailable);
    expect(fake.sessionCount()).toBe(1);
    const retried = await fake.client.verifyOtp(req);
    expect(retried.user?.phone).toBe(PHONE);
    expect(fake.sessionCount()).toBe(1);
  });
});

describe("подделка identity: токены сессии", () => {
  it.each([
    ["authenticate", () => fake.client.authenticate({ sessionToken: "bad" })],
    ["switchRole", () => fake.client.switchRole({ sessionToken: "bad", role: Role.CLIENT, idempotencyKey: "k" })],
    ["grantRole", () => fake.client.grantRole({ sessionToken: "bad", role: Role.CLIENT, idempotencyKey: "k" })],
  ])("%s с неверным токеном — Unauthenticated session_invalid", async (_n, call) => {
    expect(await rejection(call())).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
  });

  it("signOut с неверным или неизвестным токеном — успешно ничего не делает", async () => {
    await expect(fake.client.signOut({ sessionToken: "bad", idempotencyKey: "a" })).resolves.toBeDefined();
    await expect(fake.client.signOut({ sessionToken: token(9), idempotencyKey: "b" })).resolves.toBeDefined();
  });

  it("signOutEverywhere с токеном, который не доказывает вход (кривой, неизвестный, заблокированный) — успех без изменений", async () => {
    const user = await signedIn();
    await expect(fake.client.signOutEverywhere({ sessionToken: "bad", idempotencyKey: "a" })).resolves.toBeDefined();
    await expect(fake.client.signOutEverywhere({ sessionToken: token(9), idempotencyKey: "b" })).resolves.toBeDefined();
    fake.block(user.id);
    await expect(fake.client.signOutEverywhere({ sessionToken: token(1), idempotencyKey: "c" })).resolves.toBeDefined();
    expect(fake.sessionCount(user.id)).toBe(1);
  });

  it("signOutEverywhere с действующим токеном отзывает все сессии пользователя", async () => {
    const user = await signedIn();
    fake.signIn(user.id, token(2));

    await fake.client.signOutEverywhere({ sessionToken: token(1), idempotencyKey: "a" });

    expect(fake.sessionCount(user.id)).toBe(0);
  });

  it("session_token_invalid — только для токена, который задаёт вызывающий (VerifyOtp, StartDemoSession), в том числе занятого", async () => {
    await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "r" });
    expect(await rejection(fake.client.verifyOtp({ phone: PHONE, code: FAKE_OTP_CODE, sessionToken: "bad", idempotencyKey: "v" }))).toEqual({ code: Code.InvalidArgument, detail: "session_token_invalid" });

    const demo = fake.addUser({ phone: "+77001110000", isDemo: true });
    await signedIn();
    expect(await rejection(fake.client.startDemoSession({ userId: demo.id, sessionToken: token(1), idempotencyKey: "d" }))).toEqual({ code: Code.InvalidArgument, detail: "session_token_invalid" });
  });
});

describe("подделка identity: активная роль", () => {
  it("Authenticate: роль сессии не выдана (отозвана) — роль по умолчанию", async () => {
    const user = fake.addUser({ phone: PHONE, defaultRole: Role.CLIENT, roles: [Role.CLIENT] });
    fake.signIn(user.id, token(1), Role.EXECUTOR);

    const res = await fake.client.authenticate({ sessionToken: token(1) });

    expect(res.session?.activeRole).toBe(Role.CLIENT);
  });

  it("Authenticate: выданная роль сессии сохраняется, переключение в другой сессии её не меняет", async () => {
    const user = fake.addUser({ phone: PHONE, roles: [Role.CLIENT, Role.EXECUTOR] });
    fake.signIn(user.id, token(1), Role.CLIENT);
    fake.signIn(user.id, token(2), Role.CLIENT);

    await fake.client.switchRole({ sessionToken: token(2), role: Role.EXECUTOR, idempotencyKey: "s" });

    expect((await fake.client.authenticate({ sessionToken: token(1) })).session?.activeRole).toBe(Role.CLIENT);
    expect((await fake.client.authenticate({ sessionToken: token(2) })).session?.activeRole).toBe(Role.EXECUTOR);
  });
});

describe("подделка identity: демо-методы по demo.go", () => {
  const demoToken = token(5);

  it("StartDemoSession: заблокированная демо-персона — user_not_found", async () => {
    const demo = fake.addUser({ phone: PHONE, isDemo: true });
    fake.block(demo.id);
    expect(await rejection(fake.client.startDemoSession({ userId: demo.id, sessionToken: demoToken, idempotencyKey: "d" }))).toEqual({ code: Code.NotFound, detail: "user_not_found" });
  });

  it("порядок проверок: режим раньше ключа и токена, формат токена раньше ключа", async () => {
    fake.demoEnabled = false;
    expect(await rejection(fake.client.startDemoSession({ userId: "x", sessionToken: "bad" }))).toEqual({ code: Code.FailedPrecondition, detail: "demo_disabled" });
    expect(await rejection(fake.client.resetDemo({}))).toEqual({ code: Code.FailedPrecondition, detail: "demo_disabled" });
    expect(await rejection(fake.client.seedUsers({}))).toEqual({ code: Code.FailedPrecondition, detail: "demo_disabled" });
    fake.demoEnabled = true;
    expect(await rejection(fake.client.startDemoSession({ userId: "x", sessionToken: "bad" }))).toEqual({ code: Code.InvalidArgument, detail: "session_token_invalid" });
    expect(await rejection(fake.client.startDemoSession({ userId: "x", sessionToken: demoToken }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
  });

  it("VerifyOtp: повтор по ключу раньше проверки кода и занятого токена", async () => {
    await fake.client.requestOtp({ phone: PHONE, idempotencyKey: "r" });
    const req = { phone: PHONE, code: FAKE_OTP_CODE, sessionToken: token(6), idempotencyKey: "v" };
    const first = await fake.client.verifyOtp(req);
    // код уже погашен и токен занят, но повтор с тем же ключом возвращает сохранённый ответ
    expect(await fake.client.verifyOtp(req)).toBe(first);
  });

  it("ResetDemo: пользователи остаются; сессии, коды и чужие сохранённые ответы стираются, свой ответ остаётся", async () => {
    const demo = fake.addUser({ phone: PHONE, isDemo: true });
    fake.signIn(demo.id, token(1));
    await fake.client.requestOtp({ phone: "+77001110000", idempotencyKey: "r" });
    const start = { userId: demo.id, sessionToken: token(7), idempotencyKey: "s" };
    await fake.client.startDemoSession(start);

    const reset = await fake.client.resetDemo({ idempotencyKey: "x" });

    expect(fake.sessionCount()).toBe(0);
    expect(await rejection(fake.client.verifyOtp({ phone: "+77001110000", code: FAKE_OTP_CODE, sessionToken: token(8), idempotencyKey: "v" }))).toEqual({ code: Code.InvalidArgument, detail: "otp_expired" });
    // чужой ответ стёрт: повтор StartDemoSession выполняется заново (новая сессия), а не отдаёт ответ про несуществующую
    await fake.client.startDemoSession({ ...start, sessionToken: token(7) });
    expect(fake.sessionCount()).toBe(1);
    expect(await fake.client.resetDemo({ idempotencyKey: "x" })).toBe(reset);
    expect((await fake.client.authenticate({ sessionToken: token(7) })).user?.id).toBe(demo.id);
  });
});

describe("подделка identity: проверка сида по validateSeed", () => {
  const seed = (users: Parameters<typeof fake.client.seedUsers>[0]["users"]) => fake.client.seedUsers({ users, idempotencyKey: `s-${Math.random()}` });
  const invalid = { code: Code.InvalidArgument, detail: "invalid_request" };

  it("пустой список и больше 200 — invalid_request", async () => {
    expect(await rejection(seed([]))).toEqual(invalid);
    const many = Array.from({ length: 201 }, (_, i) => ({ phone: `+7700${String(i).padStart(7, "0")}`, defaultRole: Role.CLIENT, roles: [Role.CLIENT] }));
    expect(await rejection(seed(many))).toEqual(invalid);
  });

  it("повтор телефона — invalid_request; неверный телефон — invalid_phone", async () => {
    const u = { phone: PHONE, defaultRole: Role.CLIENT, roles: [Role.CLIENT] };
    expect(await rejection(seed([u, u]))).toEqual(invalid);
    expect(await rejection(seed([{ ...u, phone: "8700" }]))).toEqual({ code: Code.InvalidArgument, detail: "invalid_phone" });
  });

  it("один номер в разной записи считается повтором (как parsePhone в Go)", async () => {
    const roles = { defaultRole: Role.CLIENT, roles: [Role.CLIENT] };
    expect(await rejection(seed([{ phone: "+77001234567", ...roles }, { phone: "8 700 123 45 67", ...roles }]))).toEqual(invalid);
  });

  it("неизвестная роль, роль по умолчанию вне выданных, сотрудник с другой ролью — invalid_request", async () => {
    expect(await rejection(seed([{ phone: PHONE, defaultRole: Role.CLIENT, roles: [Role.UNSPECIFIED] }]))).toEqual(invalid);
    expect(await rejection(seed([{ phone: PHONE, defaultRole: Role.EXECUTOR, roles: [Role.CLIENT] }]))).toEqual(invalid);
    expect(await rejection(seed([{ phone: PHONE, defaultRole: Role.OPERATOR, roles: [Role.OPERATOR, Role.CLIENT] }]))).toEqual(invalid);
  });

  it("верный сид принимается", async () => {
    const res = await seed([{ phone: PHONE, defaultRole: Role.OPERATOR, roles: [Role.OPERATOR] }]);
    expect(res.users).toHaveLength(1);
  });
});

describe("подделка identity: второй фактор (как mfa.go)", () => {
  const OP_PHONE = "+77000000001";
  let clock = new Date("2026-11-11T10:00:00Z");
  const tick = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  let n = 0;
  const key = () => `k-${++n}`;
  const codeAt = (secret: string, at = clock) => totpNow(secret, at);

  /** Оператор, вошедший по SMS (без второй ступени). */
  function operator(t = 1) {
    const user = fake.addUser({ phone: OP_PHONE, defaultRole: Role.OPERATOR });
    fake.signIn(user.id, token(t), undefined, { mfaVerifiedAt: null });
    return user;
  }
  const start = (t = 1, k = key()) => fake.client.startTotpEnrollment({ sessionToken: token(t), idempotencyKey: k });
  const confirm = (code: string, t = 1, k = key()) => fake.client.confirmTotpEnrollment({ sessionToken: token(t), code, idempotencyKey: k });
  const verify = (code: string, t = 1, k = key()) => fake.client.verifySecondFactor({ sessionToken: token(t), code, idempotencyKey: k });
  /** Шесть цифр, не совпадающие с кодами окна ±1. */
  function wrong(secret: string): string {
    const window = [-30_000, 0, 30_000].map((d) => codeAt(secret, new Date(clock.getTime() + d)));
    const found = ["000000", "111111", "222222", "333333"].find((c) => !window.includes(c));
    if (!found) throw new Error("не нашлось неверного кода");
    return found;
  }

  beforeEach(() => {
    clock = new Date("2026-11-11T10:00:00Z");
    fake.now = () => clock;
  });

  it("сессия оператора по SMS — mfa_required без отметки; подключение и подтверждение ставят отметку", async () => {
    const user = operator();
    const before = (await fake.client.authenticate({ sessionToken: token(1) })).session;
    expect(before?.mfaRequired).toBe(true);
    expect(before?.mfaVerifiedAt).toBeUndefined();

    const { secretBase32 } = await start();
    expect(secretBase32).toMatch(/^[A-Z2-7]{32}$/);
    const res = await confirm(codeAt(secretBase32));
    expect(res.session?.mfaVerifiedAt && timestampDate(res.session.mfaVerifiedAt)).toEqual(clock);
    expect(fake.mfaVerifiedAtOf(token(1))).toEqual(clock);
    expect(fake.factorState(user.id)).toBe("confirmed");
  });

  it("не оператор — mfa_not_required; неизвестный токен — session_invalid; пустой или длинный код — invalid_request", async () => {
    await signedIn();
    expect(await rejection(start())).toEqual({ code: Code.FailedPrecondition, detail: "mfa_not_required" });
    expect(await rejection(verify("123456"))).toEqual({ code: Code.FailedPrecondition, detail: "mfa_not_required" });
    expect(await rejection(start(9))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
    expect(await rejection(verify(""))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(verify("1".repeat(33)))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
  });

  it("повтор Start: тот же ключ — тот же секрет; новый ключ — новый секрет, старый ключ — idempotency_key_reused", async () => {
    operator();
    const k = key();
    const first = await start(1, k);
    expect((await start(1, k)).secretBase32).toBe(first.secretBase32);
    const second = await start();
    expect(second.secretBase32).not.toBe(first.secretBase32);
    expect(await rejection(start(1, k))).toEqual({ code: Code.InvalidArgument, detail: "idempotency_key_reused" });
    // Прежний секрет не действует.
    expect(await rejection(confirm(codeAt(first.secretBase32)))).toEqual({ code: Code.InvalidArgument, detail: "mfa_wrong_code" });
    await confirm(codeAt(second.secretBase32));
    expect(await rejection(start())).toEqual({ code: Code.FailedPrecondition, detail: "mfa_already_enrolled" });
    expect(await rejection(confirm(codeAt(second.secretBase32)))).toEqual({ code: Code.FailedPrecondition, detail: "mfa_already_enrolled" });
  });

  it("не подключён — mfa_not_enrolled; начатое подключение — тоже", async () => {
    operator();
    expect(await rejection(verify("123456"))).toEqual({ code: Code.FailedPrecondition, detail: "mfa_not_enrolled" });
    const { secretBase32 } = await start();
    expect(await rejection(verify(codeAt(secretBase32)))).toEqual({ code: Code.FailedPrecondition, detail: "mfa_not_enrolled" });
  });

  it("тот же код второй раз — mfa_code_reused; код прошлого шага — тоже; новый шаг проходит", async () => {
    const user = operator();
    const secret = fake.enrollTotp(user.id);
    const code = codeAt(secret);
    await verify(code);
    expect(await rejection(verify(code))).toEqual({ code: Code.InvalidArgument, detail: "mfa_code_reused" });
    tick(30_000);
    expect(await rejection(verify(code))).toEqual({ code: Code.InvalidArgument, detail: "mfa_code_reused" });
    await expect(verify(codeAt(secret))).resolves.toBeDefined();
  });

  it("лимит: 5 неверных (left 4…0), шестой и даже верный — mfa_too_many_attempts; через 15 минут снова можно", async () => {
    const user = operator();
    const secret = fake.enrollTotp(user.id);
    const lefts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const err = await verify(wrong(secret)).then(
        () => null,
        (e: unknown) => ConnectError.from(e).findDetails(ErrorDetailSchema)[0],
      );
      expect(err?.code).toBe("mfa_wrong_code");
      lefts.push(err?.params["left"] ?? "");
    }
    expect(lefts).toEqual(["4", "3", "2", "1", "0"]);
    expect(await rejection(verify(wrong(secret)))).toEqual({ code: Code.ResourceExhausted, detail: "mfa_too_many_attempts" });
    expect(await rejection(verify(codeAt(secret)))).toEqual({ code: Code.ResourceExhausted, detail: "mfa_too_many_attempts" });
    tick(15 * 60_000 + 1000);
    await expect(verify(codeAt(secret))).resolves.toBeDefined();
  });

  it("верный код возвращает попытку: шесть верных подряд не упираются в лимит", async () => {
    const user = operator();
    const secret = fake.enrollTotp(user.id);
    for (let i = 0; i < 6; i++) {
      await verify(codeAt(secret));
      tick(30_000);
    }
    // Четыре неверных после них — ещё не лимит: left = 1.
    let left = "";
    for (let i = 0; i < 4; i++) left = (await verify(wrong(secret)).catch((e: unknown) => ConnectError.from(e).findDetails(ErrorDetailSchema)[0]?.params["left"])) as string;
    expect(left).toBe("1");
  });

  it("повтор verify с тем же ключом — тот же ответ, шаг не тратится второй раз", async () => {
    const user = operator();
    const secret = fake.enrollTotp(user.id);
    const k = key();
    const code = codeAt(secret);
    const first = await verify(code, 1, k);
    tick(3000);
    expect(await verify(code, 1, k)).toEqual(first);
    expect(await rejection(verify(wrong(secret), 1, k))).toEqual({ code: Code.InvalidArgument, detail: "idempotency_key_reused" });
    expect(await rejection(verify(code))).toEqual({ code: Code.InvalidArgument, detail: "mfa_code_reused" });
  });

  it("демо-оператор входит с пройденной второй ступенью; ResetDemo стирает факторы", async () => {
    const op = fake.addUser({ phone: OP_PHONE, defaultRole: Role.OPERATOR, isDemo: true });
    const res = await fake.client.startDemoSession({ userId: op.id, sessionToken: token(1), idempotencyKey: key() });
    expect(res.session?.mfaRequired).toBe(true);
    expect(res.session?.mfaVerifiedAt && timestampDate(res.session.mfaVerifiedAt)).toEqual(clock);
    fake.enrollTotp(op.id);
    await fake.client.resetDemo({ idempotencyKey: key() });
    expect(fake.factorState(op.id)).toBe("none");
  });

  it("mfa-reset: фактор удалён, отметка снята — Start снова выдаёт секрет", async () => {
    const user = operator();
    fake.enrollTotp(user.id);
    fake.signIn(user.id, token(2));
    expect(fake.mfaVerifiedAtOf(token(2))).toEqual(clock);
    fake.resetMfa(user.id);
    expect(fake.mfaVerifiedAtOf(token(2))).toBeNull();
    await expect(start()).resolves.toBeDefined();
  });
});

describe("подделка identity: личность и контакты (как person.go)", () => {
  const IIN = testIin("870304", 3, 61);
  const OTHER_IIN = testIin("900101", 3, 62);
  let n = 0;
  const key = () => `pk-${++n}`;
  const record = (t: number, iin = IIN, fullName = "Сапаров Ерлан", idempotencyKey = key()) => fake.client.recordPerson({ sessionToken: token(t), fullName, iin, idempotencyKey });
  const contacts = (t: number, instagram: string, email = "", idempotencyKey = key()) => fake.client.updateContacts({ sessionToken: token(t), instagram, email, idempotencyKey });

  it("порядок проверок RecordPerson: ключ, ФИО, ИИН, сессия", async () => {
    expect(await rejection(fake.client.recordPerson({ sessionToken: token(9), fullName: "x", iin: "1" }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(record(9, "1", "x"))).toEqual({ code: Code.InvalidArgument, detail: "full_name_invalid" });
    expect(await rejection(record(9, "1"))).toEqual({ code: Code.InvalidArgument, detail: "iin_invalid" });
    expect(await rejection(record(9))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
  });

  it("запись: ФИО нормализовано, ИИН — последними 4 цифрами; тот же ИИН — тот же ответ, другой — person_already_recorded", async () => {
    const user = await signedIn();
    const res = await record(1, IIN, "  Сапаров   Ерлан ");
    expect(res.person).toMatchObject({ userId: user.id, fullName: "Сапаров Ерлан", iinLast4: IIN.slice(-4) });
    expect((await record(1, IIN, "Другое Имя")).person?.fullName).toBe("Сапаров Ерлан");
    expect(await rejection(record(1, OTHER_IIN))).toEqual({ code: Code.FailedPrecondition, detail: "person_already_recorded" });
    expect(fake.auditEvents.map((e) => e.action)).toEqual(["user.identity.recorded"]);
  });

  it("ИИН другого аккаунта — iin_taken; лимит 5 попыток в час, неверный формат попытку не тратит, через час снова можно", async () => {
    const owner = fake.addUser({ phone: "+77001110000", person: { iin: IIN } });
    fake.signIn(owner.id, token(2));
    await signedIn(1);
    let now = new Date("2026-11-11T10:00:00Z");
    fake.now = () => now;
    expect(await rejection(record(1, "123"))).toEqual({ code: Code.InvalidArgument, detail: "iin_invalid" });
    for (let i = 0; i < 5; i++) expect(await rejection(record(1))).toEqual({ code: Code.AlreadyExists, detail: "iin_taken" });
    expect(await rejection(record(1))).toEqual({ code: Code.ResourceExhausted, detail: "person_too_many_attempts" });
    now = new Date(now.getTime() + 3600_000 + 1);
    expect(await rejection(record(1))).toEqual({ code: Code.AlreadyExists, detail: "iin_taken" });
  });

  it("UpdateContacts: формат до сессии, длинный Instagram — max; поля — полное состояние, журнал — без значений", async () => {
    expect(await rejection(contacts(9, "a".repeat(31)))).toEqual({ code: Code.InvalidArgument, detail: "instagram_invalid" });
    expect(await rejection(contacts(9, "дала"))).toEqual({ code: Code.InvalidArgument, detail: "instagram_invalid" });
    expect(await rejection(contacts(9, "", "не почта"))).toEqual({ code: Code.InvalidArgument, detail: "email_invalid" });
    expect(await rejection(contacts(9, ""))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
    const err = await contacts(9, "a".repeat(31)).then(
      () => null,
      (e: unknown) => ConnectError.from(e),
    );
    expect(err?.findDetails(ErrorDetailSchema)[0]?.params).toEqual({ max: "30" });

    const user = await signedIn();
    expect((await contacts(1, "@Dala", " A@Mail.KZ ")).person).toMatchObject({ userId: user.id, instagram: "Dala", email: "a@mail.kz" });
    expect((await contacts(1, "Dala")).person).toMatchObject({ instagram: "Dala", email: "" });
    expect(fake.auditEvents.map((e) => [e.action, e.before, e.after])).toEqual([
      ["user.instagram_changed", { set: false }, { set: true }],
      ["user.email_changed", { set: false }, { set: true }],
      ["user.email_changed", { set: true }, { set: false }],
    ]);
  });

  it("UpdateContacts только для активной роли заказчика или мастера — иначе role_forbidden", async () => {
    const op = fake.addUser({ phone: "+77001110001", defaultRole: Role.OPERATOR });
    fake.signIn(op.id, token(3));
    expect(await rejection(contacts(3, "ops"))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
  });

  it("GetProfile: личности нет — пустая с user_id; неизвестная сессия — session_invalid", async () => {
    const user = await signedIn();
    expect((await fake.client.getProfile({ sessionToken: token(1) })).person).toMatchObject({ userId: user.id, fullName: "", iinLast4: "" });
    expect(await rejection(fake.client.getProfile({ sessionToken: token(9) }))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
  });
});

describe("подделка identity: реквизиты исполнителя (как party.go)", () => {
  const IIN = testIin("870304", 3, 71);
  const BIN = testBin("2101", 71);
  const DIRECTOR = testIin("800215", 3, 72);
  const IBAN = "KZ86125KZT5004100100";
  let n = 0;
  const key = () => `party-${++n}`;
  const too = { legalForm: LegalForm.TOO, legalName: "ТОО «Ағаш»", binIin: BIN, signerFullName: "Тулегенов Бауыржан", signerIin: DIRECTOR };
  const ip = { legalForm: LegalForm.IP, legalName: "ИП «Дала»", binIin: "", signerFullName: "Сапаров Ерлан", signerIin: "" };
  const register = (t: number, req: Partial<typeof too> = {}) => fake.client.registerParty({ sessionToken: token(t), ...too, ...req, idempotencyKey: key() });

  it("RegisterParty: порядок проверок — ключ, реквизиты, сессия, роль EXECUTOR", async () => {
    expect(await rejection(fake.client.registerParty({ sessionToken: token(9), ...too }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(register(9, { legalForm: LegalForm.UNSPECIFIED }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(register(9, { legalName: " a " }))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(register(9, { binIin: IIN }))).toEqual({ code: Code.InvalidArgument, detail: "bin_iin_invalid" });
    expect(await rejection(register(9, { signerIin: "" }))).toEqual({ code: Code.InvalidArgument, detail: "signer_required" });
    expect(await rejection(register(9, { signerFullName: "Ерлан" }))).toEqual({ code: Code.InvalidArgument, detail: "full_name_invalid" });
    expect(await rejection(register(9, { signerIin: "123" }))).toEqual({ code: Code.InvalidArgument, detail: "iin_invalid" });
    expect(await rejection(register(9))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
    const client = fake.addUser({ phone: "+77001110010" });
    fake.signIn(client.id, token(2));
    expect(await rejection(register(2))).toEqual({ code: Code.PermissionDenied, detail: "role_not_granted" });
  });

  it("RegisterParty: ИП берёт ИИН личности, bin_iin запроса не читается; нет ИИН — person_missing", async () => {
    const user = await signedIn();
    expect(await rejection(register(1, ip))).toEqual({ code: Code.FailedPrecondition, detail: "person_missing" });
    await fake.client.recordPerson({ sessionToken: token(1), fullName: "Сапаров Ерлан", iin: IIN, idempotencyKey: key() });
    const res = await register(1, { ...ip, binIin: "мусор" });
    expect(res.party).toMatchObject({ userId: user.id, legalForm: LegalForm.IP, binIinLast4: IIN.slice(-4), signerIinLast4: "", kycStatus: KycStatus.NOT_SUBMITTED });
    expect(fake.partyNumbersOf(user.id)?.binIin).toBe(IIN);
  });

  it("RegisterParty: те же реквизиты — тот же ответ; БИН другой стороны — iin_taken; аудит без значений", async () => {
    const user = await signedIn();
    await register(1);
    expect((await register(1)).party?.binIinLast4).toBe(BIN.slice(-4));
    const other = fake.addUser({ phone: "+77001110011", roles: [Role.EXECUTOR], defaultRole: Role.EXECUTOR });
    fake.signIn(other.id, token(2));
    expect(await rejection(register(2))).toEqual({ code: Code.AlreadyExists, detail: "iin_taken" });
    expect(fake.auditEvents).toEqual([{ userId: user.id, actorRole: Role.CLIENT, action: "party.registered", after: { legal_form: "TOO" } }]);
  });

  it("RegisterParty (Ruling T): другие реквизиты перезаписывают сторону, пока KYC не подана или отклонена; иначе party_exists", async () => {
    const user = await signedIn();
    await register(1);
    await fake.client.setPayoutIban({ sessionToken: token(1), iban: IBAN, idempotencyKey: key() }).catch(() => undefined);
    const bin2 = testBin("2101", 73);
    expect((await register(1, { legalName: "ТОО «Шебер»", binIin: bin2 })).party).toMatchObject({ legalName: "ТОО «Шебер»", binIinLast4: bin2.slice(-4) });
    expect(fake.auditEvents.at(-1)).toEqual({ userId: user.id, actorRole: Role.CLIENT, action: "party.replaced", before: { legal_form: "TOO" }, after: { legal_form: "TOO" } });
    // Прежний БИН свободен; БИН другой стороны — iin_taken.
    const other = fake.addUser({ phone: "+77001110012", roles: [Role.EXECUTOR], defaultRole: Role.EXECUTOR });
    fake.signIn(other.id, token(2));
    await register(2);
    expect(await rejection(register(1, { binIin: BIN }))).toEqual({ code: Code.AlreadyExists, detail: "iin_taken" });

    fake.setKycStatus(user.id, KycStatus.REJECTED);
    expect((await register(1, { binIin: testBin("2101", 74) })).party?.kycStatus).toBe(KycStatus.REJECTED);
    for (const status of [KycStatus.PENDING, KycStatus.VERIFIED]) {
      fake.setKycStatus(user.id, status);
      expect(await rejection(register(1, { binIin: testBin("2101", 75) }))).toEqual({ code: Code.FailedPrecondition, detail: "party_exists" });
    }
  });

  it("ProvisionExecutor: оператор со второй ступенью; сотрудник — role_forbidden, заблокированный — user_blocked; отказ стороны не создаёт пользователя", async () => {
    const op = fake.addUser({ phone: "+77001110020", defaultRole: Role.OPERATOR });
    const provision = (t: number, phone: string, req: Partial<typeof too> = {}) =>
      fake.client.provisionExecutor({ sessionToken: token(t), phone, ...too, ...req, idempotencyKey: key() });
    fake.signIn(op.id, token(3), undefined, { mfaVerifiedAt: null });
    expect(await rejection(provision(3, "123"))).toEqual({ code: Code.InvalidArgument, detail: "invalid_phone" });
    expect(await rejection(provision(3, "+77001110021"))).toEqual({ code: Code.PermissionDenied, detail: "mfa_required" });
    fake.signIn(op.id, token(4));
    expect(await rejection(provision(4, op.phone))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
    const blocked = fake.addUser({ phone: "+77001110022", blocked: true });
    expect(await rejection(provision(4, blocked.phone))).toEqual({ code: Code.PermissionDenied, detail: "user_blocked" });

    const res = await provision(4, "+7 700 111 00 21");
    expect(res.user).toMatchObject({ phone: "+77001110021", roles: [Role.EXECUTOR] });
    expect(res.party).toMatchObject({ userId: res.user?.id, binIinLast4: BIN.slice(-4), signerIinLast4: DIRECTOR.slice(-4) });
    expect(await rejection(provision(4, "+77001110023"))).toEqual({ code: Code.AlreadyExists, detail: "iin_taken" });
    expect(fake.hasUser("u-77001110023")).toBe(false);

    const client = fake.addUser({ phone: "+77001110024" });
    expect((await provision(4, client.phone, { binIin: testBin("2101", 72) })).user?.roles).toEqual([Role.CLIENT, Role.EXECUTOR]);
  });

  it("SetPayoutIban: формат до сессии, только активная роль исполнителя со стороной; тот же счёт — без аудита", async () => {
    const set = (t: number, iban: string) => fake.client.setPayoutIban({ sessionToken: token(t), iban, idempotencyKey: key() });
    expect(await rejection(set(9, "KZ86"))).toEqual({ code: Code.InvalidArgument, detail: "iban_invalid" });
    const err = await set(9, "KZ86125KZT5004100101").then(
      () => null,
      (e: unknown) => ConnectError.from(e),
    );
    expect(err?.findDetails(ErrorDetailSchema)[0]?.params).toEqual({ reason: "checksum" });
    const user = fake.addUser({ phone: "+77001110030", defaultRole: Role.EXECUTOR, roles: [Role.EXECUTOR] });
    fake.signIn(user.id, token(5));
    expect(await rejection(set(5, IBAN))).toEqual({ code: Code.FailedPrecondition, detail: "party_missing" });
    await register(5);
    expect(await set(5, "kz86 125k zt50 0410 0100")).toMatchObject({ party: { payoutIbanLast4: "0100" }, changed: true });
    expect((await set(5, IBAN)).changed).toBe(false);
    expect(fake.auditEvents.filter((e) => e.action === "executor.payout_iban_changed").map((e) => [e.before, e.after])).toEqual([[{ set: false }, { set: true }]]);
    const client = fake.addUser({ phone: "+77001110031" });
    fake.signIn(client.id, token(6));
    expect(await rejection(set(6, IBAN))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
  });

  it("GetProfile отдаёт сторону; без стороны — пусто", async () => {
    const user = await signedIn();
    expect((await fake.client.getProfile({ sessionToken: token(1) })).party).toBeUndefined();
    await register(1);
    expect((await fake.client.getProfile({ sessionToken: token(1) })).party).toMatchObject({ userId: user.id, legalForm: LegalForm.TOO });
  });
});

describe("подделка identity: раскрытие и сверка ИИН (как reveal.go и VerifySignerIin в party.go)", () => {
  const CLIENT_IIN = testIin("900101", 4, 81);
  const IP_IIN = testIin("870304", 3, 82);
  const BIN = testBin("2101", 82);
  const DIRECTOR = testIin("800215", 3, 83);
  const IBAN = "KZ86125KZT5004100100";
  const reveal = (req: Parameters<typeof fake.client.revealPartyDetails>[0]) => fake.client.revealPartyDetails(req);
  const invalid = { code: Code.InvalidArgument, detail: "invalid_request" };

  function people() {
    const client = fake.addUser({ phone: "+77000000081", person: { fullName: "Сапарова Айгерим", iin: CLIENT_IIN } });
    const ip = fake.addUser({
      phone: "+77000000082",
      roles: [Role.EXECUTOR],
      defaultRole: Role.EXECUTOR,
      person: { fullName: "Сапаров Ерлан", iin: IP_IIN },
      party: { legalForm: LegalForm.IP, legalName: "ИП «Дала»", binIin: IP_IIN, signerFullName: "Сапаров Ерлан", payoutIban: IBAN },
    });
    const too = fake.addUser({
      phone: "+77000000083",
      roles: [Role.EXECUTOR],
      defaultRole: Role.EXECUTOR,
      party: { legalForm: LegalForm.TOO, legalName: "ТОО «Ағаш»", binIin: BIN, signerFullName: "Тулегенов Бауыржан", signerIin: DIRECTOR },
    });
    return { client, ip, too };
  }

  it("порядок проверок: цель (reveal_purpose_invalid), ссылка 1..128, список 1..50, затем сессия", async () => {
    const { client } = people();
    const ok = { userIds: [client.id], purpose: RevealPurpose.CONTRACT, referenceId: "deal-1" };
    expect(await rejection(reveal({ ...ok, purpose: RevealPurpose.UNSPECIFIED, referenceId: "" }))).toEqual({ code: Code.InvalidArgument, detail: "reveal_purpose_invalid" });
    expect(await rejection(reveal({ ...ok, referenceId: "" }))).toEqual(invalid);
    expect(await rejection(reveal({ ...ok, referenceId: "x".repeat(129) }))).toEqual(invalid);
    expect(await rejection(reveal({ ...ok, userIds: [], actorSessionToken: token(9) }))).toEqual(invalid);
    expect(await rejection(reveal({ ...ok, userIds: Array.from({ length: 51 }, (_, i) => `u-${i}`) }))).toEqual(invalid);
    expect(await rejection(reveal({ ...ok, actorSessionToken: token(9) }))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
  });

  it("открытые реквизиты; неизвестный пропускается, повторы убираются; аудит pii.revealed на каждого — без значений", async () => {
    const { client, ip, too } = people();
    const res = await reveal({ userIds: [client.id, ip.id, "u-unknown", ip.id, too.id], purpose: RevealPurpose.CONTRACT, referenceId: "deal-1" });
    expect(res.parties.map((p) => p.userId)).toEqual([client.id, ip.id, too.id]);
    expect(res.parties[0]).toMatchObject({ fullName: "Сапарова Айгерим", iin: CLIENT_IIN, legalForm: LegalForm.UNSPECIFIED, binIin: "" });
    expect(res.parties[1]).toMatchObject({ iin: IP_IIN, legalForm: LegalForm.IP, binIin: IP_IIN, signerIin: "", payoutIban: IBAN });
    expect(res.parties[2]).toMatchObject({ fullName: "", iin: "", legalForm: LegalForm.TOO, binIin: BIN, signerFullName: "Тулегенов Бауыржан", signerIin: DIRECTOR });
    const events = fake.auditEvents.filter((e) => e.action === "pii.revealed");
    expect(events.map((e) => [e.userId, e.actorRole, (e.after as { found: boolean }).found])).toEqual([
      [client.id, Role.UNSPECIFIED, true],
      [ip.id, Role.UNSPECIFIED, true],
      ["u-unknown", Role.UNSPECIFIED, false],
      [too.id, Role.UNSPECIFIED, true],
    ]);
    expect(events[1].after).toEqual({ purpose: "CONTRACT", reference_id: "deal-1", fields: ["full_name", "iin", "legal_name", "bin_iin", "signer_full_name", "payout_iban"], found: true });
    const text = JSON.stringify(events);
    for (const value of [CLIENT_IIN, IP_IIN, BIN, DIRECTOR, IBAN]) expect(text).not.toContain(value);
  });

  it("сессия оператора — только со второй ступенью (mfa_required); действующее лицо — в аудите", async () => {
    const { client } = people();
    const op = fake.addUser({ phone: "+77000000084", defaultRole: Role.OPERATOR, roles: [Role.OPERATOR] });
    fake.signIn(op.id, token(1), Role.OPERATOR, { mfaVerifiedAt: null });
    const req = { userIds: [client.id], purpose: RevealPurpose.RELEASE_RECEIPT, referenceId: "deal-1", actorSessionToken: token(1) };
    expect(await rejection(reveal(req))).toEqual({ code: Code.PermissionDenied, detail: "mfa_required" });
    fake.signIn(op.id, token(2), Role.OPERATOR);
    expect((await reveal({ ...req, actorSessionToken: token(2) })).parties).toHaveLength(1);
    expect(fake.auditEvents.filter((e) => e.action === "pii.revealed").map((e) => e.actorRole)).toEqual([Role.OPERATOR]);
  });

  it("VerifySignerIin: сторона не указана — invalid_request; заказчик — ИИН личности; ТОО — директор; ИП — ИИН стороны; не ИИН — нет", async () => {
    const { client, ip, too } = people();
    const verify = async (userId: string, iin: string, side: SigningSide) => (await fake.client.verifySignerIin({ userId, iin, side })).matches;
    expect(await rejection(fake.client.verifySignerIin({ userId: client.id, iin: CLIENT_IIN }))).toEqual(invalid);
    expect(await rejection(fake.client.verifySignerIin({ userId: "", iin: CLIENT_IIN, side: SigningSide.CLIENT }))).toEqual(invalid);
    expect(await verify(client.id, CLIENT_IIN, SigningSide.CLIENT)).toBe(true);
    expect(await verify(client.id, IP_IIN, SigningSide.CLIENT)).toBe(false);
    expect(await verify(client.id, CLIENT_IIN, SigningSide.EXECUTOR)).toBe(false);
    expect(await verify(ip.id, IP_IIN, SigningSide.EXECUTOR)).toBe(true);
    expect(await verify(too.id, DIRECTOR, SigningSide.EXECUTOR)).toBe(true);
    expect(await verify(too.id, BIN, SigningSide.EXECUTOR)).toBe(false);
    expect(await verify(too.id, "123", SigningSide.EXECUTOR)).toBe(false);
    expect(await verify("u-unknown", CLIENT_IIN, SigningSide.CLIENT)).toBe(false);
  });

  it("SeedUsers пишет личность и сторону (как seedPerson и seedPartyRow): ИП без bin_iin — по ИИН личности", async () => {
    const res = await fake.client.seedUsers({
      users: [
        {
          phone: "+77000000085",
          defaultRole: Role.EXECUTOR,
          roles: [Role.EXECUTOR],
          fullName: "Сапаров Ерлан",
          iin: IP_IIN,
          party: { legalForm: LegalForm.IP, legalName: "ИП «Дала»", signerFullName: "Сапаров Ерлан", payoutIban: IBAN, kycStatus: KycStatus.VERIFIED },
        },
      ],
      idempotencyKey: "seed-pii",
    });
    const id = res.users[0].id;
    expect(fake.personIinOf(id)).toBe(IP_IIN);
    expect(fake.partyNumbersOf(id)).toEqual({ binIin: IP_IIN, signerIin: "", payoutIban: IBAN });
    expect(fake.partyOf(id)?.kycStatus).toBe(KycStatus.VERIFIED);
    // Сторона — только у исполнителя (роль EXECUTOR среди выданных).
    const party = { legalForm: LegalForm.TOO, legalName: "ТОО «Ағаш»", binIin: BIN, signerFullName: "Тулегенов Бауыржан", signerIin: DIRECTOR };
    const bad = fake.client.seedUsers({ users: [{ phone: "+77000000086", defaultRole: Role.CLIENT, roles: [Role.CLIENT], party }], idempotencyKey: "seed-bad" });
    expect(await rejection(bad)).toEqual(invalid);
  });
});

describe("подделка identity: KYC исполнителя (как kyc.go и kyc_policy.go)", () => {
  const BIN = testBin("2101", 91);
  const DIRECTOR = testIin("800215", 3, 91);
  let n = 0;
  const key = () => `kyc-${++n}`;
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const one = (i: number) => [uuid(i)];

  function executor(phone: string, t: number) {
    const user = fake.addUser({
      phone,
      roles: [Role.EXECUTOR],
      defaultRole: Role.EXECUTOR,
      person: { fullName: "Тулегенов Бауыржан" },
      party: { legalForm: LegalForm.TOO, legalName: "ТОО «Ағаш»", binIin: BIN, signerFullName: "Тулегенов Бауыржан", signerIin: DIRECTOR },
    });
    fake.signIn(user.id, token(t));
    return user;
  }
  function operator(t: number, mfa = true) {
    const op = fake.addUser({ phone: `+7700111009${t}`, defaultRole: Role.OPERATOR });
    fake.signIn(op.id, token(t), undefined, mfa ? {} : { mfaVerifiedAt: null });
    return op;
  }
  const submit = (t: number, id: string[], reg: string[], idempotencyKey = key()) =>
    fake.client.submitKyc({ sessionToken: token(t), idFileIds: id, registrationFileIds: reg, idempotencyKey });
  const review = (t: number, userId: string, verify: boolean, reason = "", idempotencyKey = key()) =>
    fake.client.reviewKyc({ sessionToken: token(t), userId, verify, reason, idempotencyKey });

  it("SubmitKyc: порядок проверок — ключ, файлы, оба вида, сессия, роль, сторона", async () => {
    const invalid = { code: Code.InvalidArgument, detail: "invalid_request" };
    expect(await rejection(submit(9, one(1), one(2), ""))).toEqual(invalid);
    expect(await rejection(submit(9, ["file-1"], one(2)))).toEqual(invalid);
    expect(await rejection(submit(9, [`{${uuid(1)}}`], one(2)))).toEqual(invalid);
    expect(await rejection(submit(9, [1, 2, 3, 4, 5].map(uuid), one(2)))).toEqual(invalid);
    expect(await rejection(submit(9, [], one(2)))).toEqual({ code: Code.FailedPrecondition, detail: "kyc_documents_missing" });
    expect(await rejection(submit(9, one(1), one(2)))).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
    const client = fake.addUser({ phone: "+77001110080" });
    fake.signIn(client.id, token(2));
    expect(await rejection(submit(2, one(1), one(2)))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
    const bare = fake.addUser({ phone: "+77001110081", roles: [Role.EXECUTOR], defaultRole: Role.EXECUTOR });
    fake.signIn(bare.id, token(3));
    expect(await rejection(submit(3, one(1), one(2)))).toEqual({ code: Code.FailedPrecondition, detail: "party_missing" });
  });

  it("SubmitKyc: из NOT_SUBMITTED, PENDING (файлы заменяются) и REJECTED — PENDING; VERIFIED — kyc_transition_forbidden; повтор по ключу — тот же ответ", async () => {
    const user = executor("+77001110082", 1);
    const k = key();
    const first = await submit(1, [uuid(1).toUpperCase(), uuid(1)], one(2), k);
    expect(first.party).toMatchObject({ kycStatus: KycStatus.PENDING, kycIdFileIds: [uuid(1)], kycRegistrationFileIds: [uuid(2)] });
    expect(first.party?.kycSubmittedAt).toBeDefined();
    expect(await submit(1, [uuid(1).toUpperCase(), uuid(1)], one(2), k)).toBe(first);
    expect(await rejection(submit(1, one(3), one(2), k))).toEqual({ code: Code.InvalidArgument, detail: "idempotency_key_reused" });
    expect((await submit(1, one(3), one(4))).party?.kycIdFileIds).toEqual([uuid(3)]);
    fake.setKycStatus(user.id, KycStatus.REJECTED, { reason: "Фото нечитаемое" });
    expect((await submit(1, one(5), one(6))).party).toMatchObject({ kycStatus: KycStatus.PENDING, kycRejectReason: "" });
    fake.setKycStatus(user.id, KycStatus.VERIFIED);
    expect(await rejection(submit(1, one(7), one(8)))).toEqual({ code: Code.FailedPrecondition, detail: "kyc_transition_forbidden" });
    expect(fake.auditEvents.filter((e) => e.action === "executor.kyc_submitted").map((e) => [e.before, e.after])).toEqual([
      [{ status: "NOT_SUBMITTED" }, { status: "PENDING", id_files: 1, registration_files: 1 }],
      [{ status: "PENDING" }, { status: "PENDING", id_files: 1, registration_files: 1 }],
      [{ status: "REJECTED" }, { status: "PENDING", id_files: 1, registration_files: 1 }],
    ]);
  });

  it("ListKycQueue: оператор со второй ступенью; PENDING с обоими видами, давно ждущие первыми; ФИО — у people", async () => {
    let clock = 1_000_000;
    fake.now = () => new Date(clock);
    const late = executor("+77001110083", 1);
    const early = executor("+77001110084", 2);
    executor("+77001110085", 3); // не подал
    const noFiles = executor("+77001110086", 4);
    fake.setKycStatus(noFiles.id, KycStatus.PENDING);
    clock += 1000;
    await submit(2, one(1), one(2));
    clock += 1000;
    await submit(1, one(3), one(4));
    operator(5, false);
    expect(await rejection(fake.client.listKycQueue({ sessionToken: token(5) }))).toEqual({ code: Code.PermissionDenied, detail: "mfa_required" });
    expect(await rejection(fake.client.listKycQueue({ sessionToken: token(1) }))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
    operator(6);
    const res = await fake.client.listKycQueue({ sessionToken: token(6) });
    expect(res.parties.map((p) => p.userId)).toEqual([early.id, late.id]);
    expect(res.people.map((p) => [p.userId, p.fullName])).toEqual([
      [early.id, "Тулегенов Бауыржан"],
      [late.id, "Тулегенов Бауыржан"],
    ]);
  });

  it("ReviewKyc: порядок проверок — ключ, пользователь, причина 3–500, сессия, оператор со второй ступенью; затем сторона и переход", async () => {
    const user = executor("+77001110087", 1);
    operator(5, false);
    expect(await rejection(review(5, user.id, true, "", ""))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    expect(await rejection(review(5, "", true))).toEqual({ code: Code.InvalidArgument, detail: "invalid_request" });
    for (const reason of ["", "  ab  ", "я".repeat(501)]) {
      expect(await rejection(review(5, user.id, false, reason))).toEqual({ code: Code.InvalidArgument, detail: "kyc_reason_invalid" });
    }
    expect(await rejection(review(5, user.id, true))).toEqual({ code: Code.PermissionDenied, detail: "mfa_required" });
    expect(await rejection(review(1, user.id, true))).toEqual({ code: Code.PermissionDenied, detail: "role_forbidden" });
    operator(6);
    expect(await rejection(review(6, "u-0", true))).toEqual({ code: Code.FailedPrecondition, detail: "party_missing" });
    expect(await rejection(review(6, user.id, true))).toEqual({ code: Code.FailedPrecondition, detail: "kyc_transition_forbidden" });
    fake.setKycStatus(user.id, KycStatus.PENDING);
    expect(await rejection(review(6, user.id, true))).toEqual({ code: Code.FailedPrecondition, detail: "kyc_documents_missing" });
  });

  it("ReviewKyc: отказ с обрезанной причиной, второе решение — kyc_transition_forbidden (одновременные — одно), аудит с причиной", async () => {
    const user = executor("+77001110088", 1);
    await submit(1, one(1), one(2));
    operator(6);
    operator(7);
    const outcome = (p: Promise<unknown>) => p.then(() => "OK", () => rejection(p));
    const results = await Promise.all([outcome(review(6, user.id, false, "  Фото нечитаемое ")), outcome(review(7, user.id, true))]);
    expect(results).toEqual(["OK", { code: Code.FailedPrecondition, detail: "kyc_transition_forbidden" }]);
    expect(fake.partyOf(user.id)).toMatchObject({ kycStatus: KycStatus.REJECTED, kycRejectReason: "Фото нечитаемое" });
    expect(fake.partyOf(user.id)?.kycReviewedAt).toBeDefined();
    expect(fake.auditEvents.filter((e) => e.action.startsWith("executor.kyc_") && e.action !== "executor.kyc_submitted")).toEqual([
      { userId: user.id, actorRole: Role.OPERATOR, action: "executor.kyc_rejected", before: { status: "PENDING" }, after: { status: "REJECTED", reason: "Фото нечитаемое" } },
    ]);
  });
});
