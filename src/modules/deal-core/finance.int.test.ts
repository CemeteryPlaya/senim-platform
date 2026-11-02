import { describe, expect, it } from "vitest";
import { actingAs, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal, noCancelHooks, signContract, stagesOf } from "../../../test/factories/deal";
import { cancelDeal, confirmStagePayment, getExecutorFinance, markStagePaid } from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

/**
 * «Финансы» исполнителя: оплаты этапов его сделок — только чтение. Шаблон advance (100 000 ₸):
 * «Аванс» 50 000 до начала, «Работа» без оплаты, «Сдача» 50 000 после приёмки.
 */
describe("финансы исполнителя", () => {
  it("показывает только оплаты своих сделок; этап без суммы в список не попадает", async () => {
    const mine = await makeDeal();
    await makeDeal();

    const finance = await getExecutorFinance(mine.executor);

    expect(new Set(finance.rows.map((r) => r.dealId))).toEqual(new Set([mine.dealId]));
    expect(finance.rows.map((r) => r.stageTitle).sort()).toEqual(["Аванс", "Сдача"]);
    expect(await getExecutorFinance(await makeExecutor())).toMatchObject({ rows: [], totals: { received: 0, expected: 0, upcoming: 0 } });
  });

  it("пока договор не подписан — всё «в работе»; после подписи аванс ожидается, после подтверждения — получен", async () => {
    const f = await makeDeal();
    const [advance] = await stagesOf(f.dealId);
    const state = async () => {
      const { rows, totals } = await getExecutorFinance(f.executor);
      return { totals, rows: Object.fromEntries(rows.map((r) => [r.stageTitle, { state: r.state, payment: r.payment }])) };
    };

    expect(await state()).toEqual({
      totals: { received: 0, expected: 0, upcoming: 100_000 },
      rows: { Аванс: { state: "upcoming", payment: "DUE" }, Сдача: { state: "upcoming", payment: "DUE" } },
    });

    await signContract(f.dealId);
    expect(await state()).toEqual({
      totals: { received: 0, expected: 50_000, upcoming: 50_000 },
      rows: { Аванс: { state: "expected", payment: "DUE" }, Сдача: { state: "upcoming", payment: "DUE" } },
    });

    await markStagePaid(f.client, { stageId: advance!.id });
    expect((await state()).rows.Аванс).toEqual({ state: "expected", payment: "MARKED_PAID" });

    await confirmStagePayment(f.executor, { stageId: advance!.id });
    const after = await getExecutorFinance(f.executor);
    expect(after.totals).toEqual({ received: 50_000, expected: 0, upcoming: 50_000 });
    expect(after.rows.find((r) => r.stageTitle === "Аванс")).toMatchObject({ state: "received", date: expect.any(Date), amount: 50_000, mode: "MANUAL" });
  });

  it("неоплаченное по отменённой сделке не ждём и не показываем", async () => {
    const f = await makeDeal();
    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" }, noCancelHooks);

    expect(await getExecutorFinance(f.executor)).toMatchObject({ rows: [], totals: { received: 0, expected: 0, upcoming: 0 } });
  });

  it("сначала то, что ждёт оплаты, затем будущее, затем полученное", async () => {
    const f = await makeDeal();
    const g = await makeDeal({ executor: f.executor });
    await signContract(g.dealId);

    const states = (await getExecutorFinance(f.executor)).rows.map((r) => r.state);
    expect(states).toEqual([...states].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
    expect(states[0]).toBe("expected");
  });

  it("заказчику, оператору и исполнителю в роли заказчика — отказ", async () => {
    const f = await makeDeal();
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });

    expect(await code(getExecutorFinance(f.client))).toBe("FORBIDDEN");
    expect(await code(getExecutorFinance(await makeClient()))).toBe("FORBIDDEN");
    expect(await code(getExecutorFinance(await makeOperator()))).toBe("FORBIDDEN");
    expect(await code(getExecutorFinance(actingAs(both, "CLIENT")))).toBe("FORBIDDEN");
  });
});

const ORDER = ["expected", "upcoming", "received"];
