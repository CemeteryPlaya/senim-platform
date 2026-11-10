import { beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { recordOwnIdentity, recordPersonIdentity } from "./person-identity";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const t = ru.identity.clientIdentity;
const IIN = testIin("850412", 4, 91);
const person = { fullName: "Иван Петров", iin: IIN };

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e;
}

/** Вошёл по SMS: ФИО и ИИН нет ни в старой базе, ни в identity. */
async function smsClient() {
  const client = await makeClient();
  await db.user.update({ where: { id: client.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  await signInAs(client);
  return client;
}

describe("личность через identity: проекция в User", () => {
  it("после записи в User — ФИО и последние 4 цифры ИИН; iinEnc и iinHash web больше не пишет", async () => {
    const client = await smsClient();
    await recordOwnIdentity(client, person);
    const row = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    expect(row).toMatchObject({ fullName: "Иван Петров", iinLast4: IIN.slice(-4), iinEnc: null, iinHash: null });
  });

  it("в identity уходят сессия, ФИО, ИИН и ключ идемпотентности", async () => {
    const client = await smsClient();
    await recordOwnIdentity(client, person);
    const call = identityFake.calls.find((c) => c.method === "recordPerson");
    expect(call?.request).toMatchObject({ fullName: "Иван Петров", iin: IIN, sessionToken: expect.any(String), idempotencyKey: expect.any(String) });
  });

  it("обрыв связи после записи: повтор с тем же ключом, личность записана один раз", async () => {
    const client = await smsClient();
    identityFake.failNextAfterEffect();
    await recordOwnIdentity(client, person);
    const calls = identityFake.calls.filter((c) => c.method === "recordPerson").map((c) => (c.request as { idempotencyKey: string }).idempotencyKey);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(identityFake.auditEvents.filter((e) => e.action === "user.identity.recorded")).toHaveLength(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ iinLast4: IIN.slice(-4) });
  });
});

describe("отказы identity — тексты из ru", () => {
  it("iin_taken — «ИИН уже указан в другом аккаунте»", async () => {
    await recordOwnIdentity(await smsClient(), person);
    const err = await errorOf(recordOwnIdentity(await smsClient(), { fullName: "Пётр Иванов", iin: IIN }));
    expect([err.code, err.message]).toEqual(["CONFLICT", t.iinTaken]);
  });

  it("person_already_recorded — «ФИО и ИИН уже указаны и не меняются»", async () => {
    const client = await smsClient();
    await recordOwnIdentity(client, person);
    const err = await errorOf(recordOwnIdentity(client, { fullName: "Иван Петров", iin: testIin("900101", 3, 62) }));
    expect([err.code, err.message]).toEqual(["CONFLICT", t.alreadySet]);
  });

  it("person_too_many_attempts — «Слишком много попыток указать ИИН»: пять попыток в час, шестая — отказ", async () => {
    await recordOwnIdentity(await smsClient(), person);
    const prober = await smsClient();
    for (let i = 0; i < 5; i++) expect((await errorOf(recordOwnIdentity(prober, person))).code).toBe("CONFLICT");
    const err = await errorOf(recordOwnIdentity(prober, person));
    expect([err.code, err.message]).toEqual(["RATE_LIMITED", t.tooMany]);
  });

  it("iin_invalid и full_name_invalid — ошибки полей iin и fullName", async () => {
    const client = await smsClient();
    const iin = await errorOf(recordOwnIdentity(client, { ...person, iin: "123" }));
    expect([iin.code, iin.message, iin.details]).toEqual(["VALIDATION", t.iinInvalid, { fieldErrors: { iin: [t.iinInvalid] } }]);
    const name = await errorOf(recordOwnIdentity(client, { ...person, fullName: "Иван" }));
    expect([name.code, name.message, name.details]).toEqual(["VALIDATION", t.fullNameInvalid, { fieldErrors: { fullName: [t.fullNameInvalid] } }]);
  });
});

describe("recordPersonIdentity — до транзакции договора", () => {
  it("ФИО и ИИН уже в аккаунте — identity не зовётся, переданные данные не пишутся", async () => {
    const client = await makeClient();
    await recordPersonIdentity(client, person);
    expect(identityFake.calls.filter((c) => c.method === "recordPerson")).toHaveLength(0);
  });

  it("данных нет и не переданы — VALIDATION «Укажите ФИО и ИИН»", async () => {
    const err = await errorOf(recordPersonIdentity(await smsClient(), undefined));
    expect([err.code, err.message]).toEqual(["VALIDATION", t.required]);
  });
});
