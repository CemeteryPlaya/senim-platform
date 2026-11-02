import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { getOwnContacts, updateContacts } from "./contacts-profile";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const audit = (userId: string) => db.auditEvent.findMany({ where: { entityId: userId, action: "user.instagram_changed" } });

describe("Instagram в профиле заказчика и мастера", () => {
  it.each([["заказчик", makeClient], ["мастер", makeExecutor]] as const)("%s сохраняет Instagram без «@» и видит его в профиле", async (_, make) => {
    const user = await make();
    await updateContacts(user, { instagram: "@Dala.Mebel" });
    expect(await getOwnContacts(user)).toEqual({ phone: user.phone, instagram: "Dala.Mebel" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).instagram).toBe("Dala.Mebel");
  });

  it("пустое поле убирает Instagram; журнал — без значения", async () => {
    const user = await makeClient();
    await updateContacts(user, { instagram: "aigerim.home" });
    await updateContacts(user, { instagram: "" });
    expect((await getOwnContacts(user)).instagram).toBeNull();
    const events = await audit(user.id);
    expect(events.map((e) => [e.before, e.after])).toEqual([
      [{ set: false }, { set: true }],
      [{ set: true }, { set: false }],
    ]);
    expect(JSON.stringify(events.map((e) => [e.before, e.after, e.meta]))).not.toContain("aigerim");
  });

  it("то же значение ещё раз — без второй записи в журнале", async () => {
    const user = await makeClient();
    await updateContacts(user, { instagram: "aigerim.home" });
    await updateContacts(user, { instagram: "@aigerim.home" });
    expect(await audit(user.id)).toHaveLength(1);
  });

  it("неверное имя — VALIDATION, ничего не меняется; оператору поле не нужно — FORBIDDEN", async () => {
    const user = await makeClient();
    expect(await code(updateContacts(user, { instagram: "дала мебель" }))).toBe("VALIDATION");
    expect((await getOwnContacts(user)).instagram).toBeNull();
    expect(await code(updateContacts(await makeOperator(), { instagram: "ops" }))).toBe("FORBIDDEN");
  });
});
