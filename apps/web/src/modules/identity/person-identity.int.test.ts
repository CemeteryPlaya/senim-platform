import { describe, expect, it } from "vitest";
import { testIin } from "@/demo/kz-id";
import { db } from "@/platform/db";
import { makeClient } from "../../../test/factories";
import { limitIdentityAttempts } from "./person-identity";

const identity = { fullName: "Иван Петров", iin: testIin("850412", 4, 91) };
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

describe("limitIdentityAttempts — до транзакции договора", () => {
  it("без ИИН в аккаунте: пять попыток в час, шестая — RATE_LIMITED", async () => {
    const client = await makeClient();
    await db.user.update({ where: { id: client.id }, data: { iinEnc: null, iinHash: null, iinLast4: null } });
    for (let i = 0; i < 5; i++) expect(await code(limitIdentityAttempts(client, identity))).toBe("OK");
    expect(await code(limitIdentityAttempts(client, identity))).toBe("RATE_LIMITED");
  });

  it("ИИН не передан или уже в аккаунте — попытка не считается", async () => {
    const client = await makeClient();
    for (let i = 0; i < 6; i++) expect(await code(limitIdentityAttempts(client, identity))).toBe("OK");
    await db.user.update({ where: { id: client.id }, data: { iinEnc: null, iinHash: null, iinLast4: null } });
    for (let i = 0; i < 6; i++) expect(await code(limitIdentityAttempts(client, undefined))).toBe("OK");
  });
});
