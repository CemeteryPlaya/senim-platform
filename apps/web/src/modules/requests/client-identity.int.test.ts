import { beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { makeMeasured, makeMeasuring, makeOpenRequest, withPreContractFlows } from "../../../test/factories/requests";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { agreeToContract } from "./index";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

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

/** Действие заказчика — в его сессии: identity записывает личность того, чья сессия в cookie. */
async function as<T>(user: { id: string }, call: () => Promise<T>): Promise<T> {
  await signInAs(user);
  return call();
}

const recordPersonCalls = () => identityFake.calls.filter((c) => c.method === "recordPerson").length;

// Согласие на договор со сбором ФИО и ИИН — шаг сценариев до договора (флаг preContractFlows).
withPreContractFlows();

describe("ФИО и ИИН заказчика перед договором", () => {
  it("без данных — понятная ошибка, сделка не создаётся", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    expect(await code(as(client, () => agreeToContract(client, { requestId: m.requestId })))).toBe("VALIDATION");
    expect(await db.deal.count()).toBe(0);
    expect(recordPersonCalls()).toBe(0);
  });

  it("с данными — записаны в identity (в User — ФИО и последние 4 цифры, без шифртекста), сделка создана", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    await as(client, () => agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Сапарова  Айгерим", iin: IIN } }));

    const user = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    expect(user).toMatchObject({ fullName: "Сапарова Айгерим", iinLast4: IIN.slice(-4), iinEnc: null, iinHash: null });
    expect(identityFake.personOf(client.id)).toMatchObject({ fullName: "Сапарова Айгерим", iinLast4: IIN.slice(-4) });
    expect(await db.deal.count()).toBe(1);
    const audit = identityFake.auditEvents.filter((e) => e.action === "user.identity.recorded");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(IIN);
  });

  it("неверный ИИН и ИИН другого аккаунта — отказ, сделки нет", async () => {
    const client = await smsClient();
    const m = await makeMeasured(client);
    const bad = IIN.slice(0, 11) + ((Number(IIN[11]) + 1) % 10);
    expect(await code(as(client, () => agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Иван Петров", iin: bad } })))).toBe(
      "VALIDATION",
    );

    const other = await smsClient();
    const m2 = await makeMeasured(other);
    await as(other, () => agreeToContract(other, { requestId: m2.requestId, identity: { fullName: "Иван Петров", iin: IIN } }));
    const taken = await errorOf(as(client, () => agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Пётр Иванов", iin: IIN } })));
    expect([taken.code, taken.message]).toEqual(["CONFLICT", ru.identity.clientIdentity.iinTaken]);
    expect(await db.deal.count()).toBe(1);
  });

  it("«ИИН занят» не раскрывается, пока заявка не на шаге договора: сначала переход и замер, потом ИИН", async () => {
    const owner = await smsClient();
    const mo = await makeMeasured(owner);
    await as(owner, () => agreeToContract(owner, { requestId: mo.requestId, identity: { fullName: "Иван Петров", iin: IIN } }));

    const prober = await smsClient();
    const identity = { fullName: "Пётр Иванов", iin: IIN };
    const calls = recordPersonCalls();
    // Заявка открыта (не MEASURING) — ответ о переходе, а не об ИИН.
    const open = await makeOpenRequest(prober);
    const notMeasuring = await errorOf(as(prober, () => agreeToContract(prober, { requestId: open, identity })));
    expect(notMeasuring.message).not.toBe(ru.identity.clientIdentity.iinTaken);
    // Замер назначен, но не выполнен — ответ о замере.
    const measuring = await makeMeasuring(prober);
    const noResult = await errorOf(as(prober, () => agreeToContract(prober, { requestId: measuring.requestId, identity })));
    expect(noResult.message).toBe(ru.requests.errors.noMeasurementResult);
    // identity не спрашивали: ни ответа об ИИН, ни потраченной попытки.
    expect(recordPersonCalls()).toBe(calls);
  });

  it("попытки указать ИИН ограничены: 5 в час на пользователя", async () => {
    const owner = await smsClient();
    const mo = await makeMeasured(owner);
    await as(owner, () => agreeToContract(owner, { requestId: mo.requestId, identity: { fullName: "Иван Петров", iin: IIN } }));

    const prober = await smsClient();
    const m = await makeMeasured(prober);
    const attempt = () => as(prober, () => agreeToContract(prober, { requestId: m.requestId, identity: { fullName: "Пётр Иванов", iin: IIN } }));
    for (let i = 0; i < 5; i++) expect(await code(attempt())).toBe("CONFLICT");
    const limited = await errorOf(attempt());
    expect([limited.code, limited.message]).toEqual(["RATE_LIMITED", ru.identity.clientIdentity.tooMany]);
  });

  it("данные уже есть — переданные повторно не перезаписывают их, identity не зовётся", async () => {
    const client = await makeClient();
    const before = await db.user.findUniqueOrThrow({ where: { id: client.id } });
    const m = await makeMeasured(client);
    await as(client, () => agreeToContract(client, { requestId: m.requestId, identity: { fullName: "Другое Имя", iin: IIN } }));
    expect(await db.user.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ fullName: before.fullName, iinLast4: before.iinLast4 });
    expect(recordPersonCalls()).toBe(0);
  });
});
