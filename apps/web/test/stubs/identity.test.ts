import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import { Role } from "@/gen/senim/identity/v1/identity_pb";
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

  it("тот же ключ с другим запросом — idempotency_key_reused", async () => {
    await fake.client.resetDemo({ idempotencyKey: "k" });
    expect(await rejection(fake.client.requestOtp({ phone: PHONE, idempotencyKey: "k" }))).toEqual({ code: Code.InvalidArgument, detail: "idempotency_key_reused" });
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
    ["signOutEverywhere", () => fake.client.signOutEverywhere({ sessionToken: "bad", idempotencyKey: "k" })],
  ])("%s с неверным токеном — Unauthenticated session_invalid", async (_n, call) => {
    expect(await rejection(call())).toEqual({ code: Code.Unauthenticated, detail: "session_invalid" });
  });

  it("signOut с неверным или неизвестным токеном — успешно ничего не делает", async () => {
    await expect(fake.client.signOut({ sessionToken: "bad", idempotencyKey: "a" })).resolves.toBeDefined();
    await expect(fake.client.signOut({ sessionToken: token(9), idempotencyKey: "b" })).resolves.toBeDefined();
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
