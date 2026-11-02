import { beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/demo/kz-id";
import { decryptPii, hashPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { freshBrowser } from "../../../test/factories/identity";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { needsIntroduction } from "./introduction";
import { recordOwnIdentity } from "./person-identity";
import { getCurrentUser, requireUserPage, startSession } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const IIN = testIin("870304", 3, 61);
const me = { fullName: "Сапаров  Ерлан", iin: IIN };

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
}

async function redirectTarget(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2];
  }
}

/** Только что вошёл по SMS: ни ФИО, ни ИИН. */
async function newcomer() {
  const user = await makeClient();
  await db.user.update({ where: { id: user.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  await startSession(user.id);
  return (await getCurrentUser())!;
}

describe("знакомство: ФИО и ИИН один раз после первого входа (№26)", () => {
  it("новый пользователь без ФИО и ИИН — страницы заказчика ведут на знакомство с возвратом", async () => {
    const user = await newcomer();
    expect(needsIntroduction(user)).toBe(true);
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/welcome?next=%2Frequests");
  });

  it("сохраняет ФИО и ИИН (ИИН — только зашифрованным), после этого страницы открываются", async () => {
    const user = await newcomer();

    await recordOwnIdentity(user, me);

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ fullName: "Сапаров Ерлан", iinHash: hashPii(IIN), iinLast4: IIN.slice(-4) });
    expect(row.iinEnc).not.toContain(IIN);
    expect(decryptPii(row.iinEnc!)).toBe(IIN);
    expect(await db.auditEvent.count({ where: { action: "user.identity.recorded", entityId: user.id } })).toBe(1);

    const after = (await getCurrentUser())!;
    expect(needsIntroduction(after)).toBe(false);
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBeNull();
  });

  it("после сохранения пользователь не меняет ни ИИН, ни ФИО", async () => {
    const user = await newcomer();
    await recordOwnIdentity(user, me);

    expect(await codeOf(recordOwnIdentity(user, { fullName: "Другой Человек", iin: testIin("900101", 3, 62) }))).toBe("CONFLICT");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ fullName: "Сапаров Ерлан", iinHash: hashPii(IIN) });
  });

  it("двойная отправка формы: записывается один раз, второй ответ — понятный конфликт", async () => {
    const user = await newcomer();
    const results = await Promise.allSettled([recordOwnIdentity(user, me), recordOwnIdentity(user, me)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "user.identity.recorded", entityId: user.id } })).toBe(1);
  });

  it("ИИН с неверной контрольной цифрой и неполное ФИО — ошибки полей", async () => {
    const user = await newcomer();
    expect(await codeOf(recordOwnIdentity(user, { ...me, iin: `${IIN.slice(0, 11)}${(Number(IIN[11]) + 1) % 10}` }))).toBe("VALIDATION");
    expect(await codeOf(recordOwnIdentity(user, { ...me, fullName: "Ерлан" }))).toBe("VALIDATION");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ iinHash: null });
  });

  it("ИИН другого аккаунта — «ИИН занят»; перебор ограничен пятью попытками в час", async () => {
    const owner = await newcomer();
    await recordOwnIdentity(owner, me);

    freshBrowser();
    const prober = await newcomer();
    for (let i = 0; i < 5; i++) expect(await codeOf(recordOwnIdentity(prober, me))).toBe("CONFLICT");
    expect(await codeOf(recordOwnIdentity(prober, me))).toBe("RATE_LIMITED");
  });

  it("оператору знакомство не нужно; у заполненных аккаунтов его нет", async () => {
    expect(needsIntroduction(await makeOperator())).toBe(false);
    expect(needsIntroduction(await makeClient())).toBe(false);
    expect(needsIntroduction(await makeExecutor())).toBe(false);
  });
});
