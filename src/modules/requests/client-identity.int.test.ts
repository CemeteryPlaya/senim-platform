import { describe, expect, it } from "vitest";
import { testIin } from "@/demo/kz-id";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { makeClient } from "../../../test/factories";
import { makeMeasured } from "../../../test/factories/requests";
import { agreeToContract } from "./index";

const IIN = testIin("850412", 4, 77);
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

/** Заказчик вошёл по SMS: ФИО и ИИН нет — их спрашивают перед договором (сторона договора, подпись ЭЦП). */
async function smsClient() {
  const client = await makeClient();
  await db.user.update({ where: { id: client.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  return client;
}

describe("ФИО и ИИН заказчика перед договором", () => {
  it("без данных — понятная ошибка, сделка не создаётся", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    expect(await code(agreeToContract(client, { requestId: m.requestId, template: "advance-50" }))).toBe("VALIDATION");
    expect(await db.deal.count()).toBe(0);
  });

  it("с данными — записаны (ИИН зашифрован), сделка создана, событие в журнале без ИИН", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Сапарова  Айгерим", iin: IIN } });

    const user = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    expect(user).toMatchObject({ fullName: "Сапарова Айгерим", iinLast4: IIN.slice(-4) });
    expect(user.iinEnc).not.toContain(IIN);
    expect(decryptPii(user.iinEnc!)).toBe(IIN);
    expect(await db.deal.count()).toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "user.identity.recorded" } });
    expect(JSON.stringify([audit.before, audit.after, audit.meta])).not.toContain(IIN);
  });

  it("неверный ИИН и ИИН другого аккаунта — отказ", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    const bad = IIN.slice(0, 11) + ((Number(IIN[11]) + 1) % 10);
    expect(await code(agreeToContract(client, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Иван Петров", iin: bad } }))).toBe(
      "VALIDATION",
    );

    const other = await smsClient();
    const m2 = await makeMeasured(other);
    await agreeToContract(other, { requestId: m2.requestId, template: "advance-50", identity: { fullName: "Иван Петров", iin: IIN } });
    expect(await code(agreeToContract(client, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Пётр Иванов", iin: IIN } }))).toBe(
      "CONFLICT",
    );
  });

  it("данные уже есть — переданные повторно не перезаписывают их", async () => {
    const client = await makeClient();
    const before = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId, template: "advance-50", identity: { fullName: "Другое Имя", iin: IIN } });
    expect(await db.user.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ fullName: before.fullName, iinHash: before.iinHash });
  });
});
