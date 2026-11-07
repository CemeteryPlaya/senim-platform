import { describe, expect, it } from "vitest";
import { onMoneySettled } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { confirmPending, dealAt, signAct } from "../../../test/factories/deal";
import { assertPayoutIbanChangeable, hasPendingPayout } from "./payout-lock";
import { failManualOperation } from "./providers/manual";

/** Смена счёта мастера, пока банк проводит его выплату, запрещена: деньги ушли бы на новый счёт без проверки. */
describe("счёт для выплаты при ждущей выплате", () => {
  it("выплата ждёт банка — ошибка поля iban; выплата проведена — снова можно", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await expect(assertPayoutIbanChangeable(f.executor)).resolves.toBeUndefined();
    await signAct(f.dealId);
    expect(await hasPendingPayout(f.executor.executor.id)).toBe(true);
    await expect(assertPayoutIbanChangeable(f.executor)).rejects.toMatchObject({ code: "VALIDATION", details: { fieldErrors: { iban: [expect.any(String)] } } });

    await confirmPending(f.dealId, "RELEASE");
    await confirmPending(f.dealId, "SPLIT_MASTER");
    expect(await hasPendingPayout(f.executor.executor.id)).toBe(false);
    await expect(assertPayoutIbanChangeable(f.executor)).resolves.toBeUndefined();
  });

  it("выплата отклонена (неверный счёт) — смена разрешена: так её и исправляют перед повтором", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await confirmPending(f.dealId, "RELEASE");
    const master = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "SPLIT_MASTER" } });
    await failManualOperation(await makeOperator(), { transactionId: master.id, reason: "Неверный IBAN получателя" }, onMoneySettled);
    await expect(assertPayoutIbanChangeable(f.executor)).resolves.toBeUndefined();
  });

  it("ждущая выплата другого мастера не мешает", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    const other = await dealAt("SIGNED");
    expect(await hasPendingPayout(other.executor.executor.id)).toBe(false);
  });
});
