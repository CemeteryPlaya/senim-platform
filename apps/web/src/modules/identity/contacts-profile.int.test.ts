import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { getOwnContacts, updateContacts } from "./contacts-profile";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const t = ru.identity.contacts;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const audit = (userId: string, action = "user.instagram_changed") => identityFake.auditEvents.filter((e) => e.userId === userId && e.action === action);

/** Вошедший пользователь фабрики: его контакты — в identity (подделка) и в проекции. */
async function signedIn<U extends { id: string }>(user: Promise<U>): Promise<U> {
  const u = await user;
  await signInAs(u);
  return u;
}

describe("Instagram в профиле заказчика и мастера", () => {
  it.each([["заказчик", makeClient], ["мастер", makeExecutor]] as const)("%s сохраняет Instagram без «@» и видит его в профиле", async (_, make) => {
    const user = await signedIn(make());
    await updateContacts(user, { instagram: "@Dala.Mebel" });
    expect(await getOwnContacts(user)).toEqual({ phone: user.phone, instagram: "Dala.Mebel", email: null });
    expect(identityFake.personOf(user.id).instagram).toBe("Dala.Mebel");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).instagram).toBe("Dala.Mebel");
  });

  it("пустое поле убирает Instagram; журнал identity — без значения", async () => {
    const user = await signedIn(makeClient());
    await updateContacts(user, { instagram: "aigerim.home" });
    await updateContacts(user, { instagram: "" });
    expect((await getOwnContacts(user)).instagram).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).instagram).toBeNull();
    const events = audit(user.id);
    expect(events.map((e) => [e.before, e.after])).toEqual([
      [{ set: false }, { set: true }],
      [{ set: true }, { set: false }],
    ]);
    expect(JSON.stringify(events)).not.toContain("aigerim");
  });

  it("то же значение ещё раз — без второй записи в журнале", async () => {
    const user = await signedIn(makeClient());
    await updateContacts(user, { instagram: "aigerim.home" });
    await updateContacts(user, { instagram: "@aigerim.home" });
    expect(audit(user.id)).toHaveLength(1);
  });

  it("неверное имя — VALIDATION без вызова identity; оператору поле не нужно — FORBIDDEN", async () => {
    const user = await signedIn(makeClient());
    expect(await code(updateContacts(user, { instagram: "дала мебель" }))).toBe("VALIDATION");
    expect((await getOwnContacts(user)).instagram).toBeNull();
    expect(identityFake.calls.filter((c) => c.method === "updateContacts")).toHaveLength(0);
    expect(await code(updateContacts(await signedIn(makeOperator()), { instagram: "ops" }))).toBe("FORBIDDEN");
  });

  it("отказ identity instagram_invalid с params.max — текст «Не длиннее N символов» у поля instagram", async () => {
    const user = await signedIn(makeClient());
    identityFake.failNextWithCode("instagram_invalid", { max: "30" });
    const err = await updateContacts(user, { instagram: "dala" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "VALIDATION", message: t.instagramTooLong(30), details: { fieldErrors: { instagram: [t.instagramTooLong(30)] } } });
  });
});

describe("e-mail в профиле — для копии подписанного акта", () => {
  it("сохраняется без пробелов по краям и в нижнем регистре; Instagram при этом не трогается; журнал — без значения", async () => {
    const user = await signedIn(makeClient());
    await updateContacts(user, { instagram: "aigerim.home" });
    await updateContacts(user, { instagram: "aigerim.home", email: "  Aigerim@Example.KZ " });
    expect(await getOwnContacts(user)).toMatchObject({ instagram: "aigerim.home", email: "aigerim@example.kz" });
    await updateContacts(user, { instagram: "aigerim.home", email: "" });
    expect((await getOwnContacts(user)).email).toBeNull();
    const events = audit(user.id, "user.email_changed");
    expect(events.map((e) => [e.before, e.after])).toEqual([
      [{ set: false }, { set: true }],
      [{ set: true }, { set: false }],
    ]);
    expect(JSON.stringify(events)).not.toContain("example.kz");
  });

  it("без поля e-mail — в identity уходит прежний адрес (поля — полное состояние), он остаётся; неверный адрес — VALIDATION", async () => {
    const user = await signedIn(makeExecutor());
    await updateContacts(user, { instagram: "", email: "master@example.kz" });
    await updateContacts(user, { instagram: "dala" });
    const last = identityFake.calls.filter((c) => c.method === "updateContacts").at(-1);
    expect(last?.request).toMatchObject({ instagram: "dala", email: "master@example.kz" });
    expect((await getOwnContacts(user)).email).toBe("master@example.kz");
    expect(await code(updateContacts(user, { instagram: "", email: "не почта" }))).toBe("VALIDATION");
    expect((await getOwnContacts(user)).email).toBe("master@example.kz");
  });

  it("контакты читаются из identity и пишутся в проекцию", async () => {
    const user = await signedIn(makeClient());
    await db.user.update({ where: { id: user.id }, data: { email: "stale@example.kz" } });
    expect((await getOwnContacts(user)).email).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBeNull();
  });
});
