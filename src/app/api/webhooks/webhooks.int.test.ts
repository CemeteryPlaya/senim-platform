import { describe, expect, it } from "vitest";
import { simulatorDeposit } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeDeal, signContract } from "../../../../test/factories/deal";
import { POST as bankWebhook } from "./bank/route";
import { POST as simulatorWebhook } from "./escrow-simulator/route";

const post = (body: string, headers: Record<string, string>) =>
  new Request("http://localhost/api/webhooks/escrow-simulator", { method: "POST", body, headers });

describe("маршруты вебхуков", () => {
  it("симулятор: подписанный вебхук принят, повтор — 200 с duplicate, подделка — 401", async () => {
    const f = await makeDeal({ rail: "escrow-simulator" });
    await signContract(f.dealId);
    const account = await db.escrowAccount.findUniqueOrThrow({ where: { dealId: f.dealId } });
    const delivery = await simulatorDeposit(f.client, { accountId: account.id, amount: 100_000 });

    const first = await simulatorWebhook(post(delivery.rawBody, delivery.headers));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });

    const again = await simulatorWebhook(post(delivery.rawBody, delivery.headers));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });

    const forged = await simulatorWebhook(post(delivery.rawBody.replace("100000", "1"), delivery.headers));
    expect(forged.status).toBe(401);
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("IN_PROGRESS");
  });

  it("банк ещё не подключён — 503, банк повторит доставку", async () => {
    const res = await bankWebhook(post("{}", { "content-type": "application/json" }));
    expect(res.status).toBe(503);
  });
});
