import { describe, expect, it } from "vitest";
import { testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient } from "../../../test/factories";
import { makeMeasured, makeMeasuring, makeOpenRequest, withPreContractFlows } from "../../../test/factories/requests";
import { agreeToContract } from "./index";

const IIN = testIin("850412", 4, 77);
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e;
}

/** Заказчик вошёл по SMS: ФИО и ИИН нет — их спрашивают перед договором (сторона договора, подпись ЭЦП). */
async function smsClient() {
  const client = await makeClient();
  await db.user.update({ where: { id: client.id }, data: { fullName: null, iinEnc: null, iinHash: null, iinLast4: null } });
  return client;
}

// Согласие на договор со сбором ФИО и ИИН — шаг сценариев до договора (флаг preContractFlows).
withPreContractFlows();

describe("ФИО и ИИН заказчика перед договором", () => {
  it("без данных — понятная ошибка, сделка не создаётся", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    expect(await code(agreeToContract(client, { requestId: m.requestId }))).toBe("VALIDATION");
    expect(await db.deal.count()).toBe(0);
  });

  it("с данными — записаны (ИИН зашифрован), сделка создана, событие в журнале без ИИН", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Сапарова  Айгерим", iin: IIN } });

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
    expect(await code(agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Иван Петров", iin: bad } }))).toBe(
      "VALIDATION",
    );

    const other = await smsClient();
    const m2 = await makeMeasured(other);
    await agreeToContract(other, { requestId: m2.requestId, identity: { fullName: "Иван Петров", iin: IIN } });
    expect(await code(agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Пётр Иванов", iin: IIN } }))).toBe(
      "CONFLICT",
    );
  });

  it("«ИИН занят» не раскрывается, пока заявка не на шаге договора: сначала переход и замер, потом ИИН", async () => {
    const owner = await smsClient();
    const mo = await makeMeasured(owner);
    await agreeToContract(owner, { requestId: mo.requestId, identity: { fullName: "Иван Петров", iin: IIN } });

    const prober = await smsClient();
    const identity = { fullName: "Пётр Иванов", iin: IIN };
    // Заявка открыта (не MEASURING) — ответ о переходе, а не об ИИН.
    const open = await makeOpenRequest(prober);
    const notMeasuring = await errorOf(agreeToContract(prober, { requestId: open, identity }));
    expect(notMeasuring.message).not.toBe(ru.identity.clientIdentity.iinTaken);
    // Замер назначен, но не выполнен — ответ о замере.
    const measuring = await makeMeasuring(prober);
    const noResult = await errorOf(agreeToContract(prober, { requestId: measuring.requestId, identity }));
    expect(noResult.message).toBe(ru.requests.errors.noMeasurementResult);
  });

  it("попытки указать ИИН ограничены: 5 в час на пользователя", async () => {
    const owner = await smsClient();
    const mo = await makeMeasured(owner);
    await agreeToContract(owner, { requestId: mo.requestId, identity: { fullName: "Иван Петров", iin: IIN } });

    const prober = await smsClient();
    const m = await makeMeasured(prober);
    const attempt = () => agreeToContract(prober, { requestId: m.requestId, identity: { fullName: "Пётр Иванов", iin: IIN } });
    for (let i = 0; i < 5; i++) expect(await code(attempt())).toBe("CONFLICT");
    expect(await code(attempt())).toBe("RATE_LIMITED");
  });

  it("данные уже есть — переданные повторно не перезаписывают их", async () => {
    const client = await makeClient();
    const before = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Другое Имя", iin: IIN } });
    expect(await db.user.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ fullName: before.fullName, iinHash: before.iinHash });
  });
});
