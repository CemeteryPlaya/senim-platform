import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { dealAt, signAct } from "../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import { savePayoutIban } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const IBAN = "KZ86125KZT5004100100";
const setPayoutCalls = () => identityFake.calls.filter((c) => c.method === "setPayoutIban");

/** Порядок «payout-lock, потом identity»: пока банк проводит выплату мастеру, счёт в identity не меняется. */
describe("savePayoutIban", () => {
  it("ждущая выплата — ошибка у поля iban, SetPayoutIban не вызывается", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await signInAs(f.executor);

    const res = await savePayoutIban({ iban: IBAN });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { iban: [ru.payments.errors.payoutPending] } });
    expect(setPayoutCalls()).toHaveLength(0);
    expect((await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id } })).payoutIbanLast4).toBeNull();
  });

  it("выплаты не ждут — счёт уходит в identity, в проекции последние 4", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(f.executor);

    expect(await savePayoutIban({ iban: IBAN })).toEqual({ ok: true, data: { last4: "0100" } });
    expect(setPayoutCalls()).toHaveLength(1);
  });
});
