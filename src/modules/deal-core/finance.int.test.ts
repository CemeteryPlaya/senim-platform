import { describe, expect, it } from "vitest";
import { actingAs, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal, noCancelHooks, signContract, stagesOf } from "../../../test/factories/deal";
import { db } from "@/platform/db";
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

/** Аванс сделки получен (заказчик отметил, исполнитель подтвердил) в момент `at` — как будто подтвердили тогда. */
async function advanceReceivedAt(f: Awaited<ReturnType<typeof makeDeal>>, at: string) {
  const [advance] = await stagesOf(f.dealId);
  await signContract(f.dealId);
  await markStagePaid(f.client, { stageId: advance!.id });
  await confirmStagePayment(f.executor, { stageId: advance!.id });
  await db.stagePayment.update({ where: { stageId: advance!.id }, data: { confirmedAt: new Date(at) } });
}

/** Заработок за месяц: полученное по дате подтверждения, месяцы — по времени Алматы (UTC+5). */
describe("финансы исполнителя по месяцам", () => {
  const now = new Date("2026-11-15T07:00:00Z");

  it("граница месяцев — полночь по Алматы, а не по UTC", async () => {
    const october = await makeDeal({ total: 100_000 });
    const november = await makeDeal({ executor: october.executor, total: 60_000 });
    await advanceReceivedAt(october, "2026-10-31T18:59:00Z"); // 31 октября, 23:59 в Алматы
    await advanceReceivedAt(november, "2026-10-31T19:01:00Z"); // 1 ноября, 00:01 в Алматы

    const current = (await getExecutorFinance(october.executor, { now })).month;
    expect(current).toMatchObject({ month: "2026-11", received: 30_000, previous: 50_000, prev: "2026-10", next: null });
    expect(current.rows.map((r) => r.dealId)).toEqual([november.dealId]);

    const past = (await getExecutorFinance(october.executor, { month: "2026-10", now })).month;
    expect(past).toMatchObject({ received: 50_000, previous: 0, prev: null, next: "2026-11" });
    expect(past.rows.map((r) => r.dealId)).toEqual([october.dealId]);
  });

  it("пустые месяцы — нули без оплат; месяц вне промежутка — ближайший край", async () => {
    const f = await makeDeal();
    await advanceReceivedAt(f, "2026-08-10T07:00:00Z");
    const month = async (m?: "2026-09" | "2026-10" | "2027-01" | "2020-01") => (await getExecutorFinance(f.executor, { month: m, now })).month;

    expect(await month("2026-09")).toMatchObject({ month: "2026-09", received: 0, previous: 50_000, rows: [], prev: "2026-08", next: "2026-10" });
    expect(await month("2026-10")).toMatchObject({ received: 0, previous: 0, rows: [] });
    expect(await month()).toMatchObject({ month: "2026-11", received: 0, previous: 0, rows: [] });
    expect((await month("2027-01")).month).toBe("2026-11");
    expect((await month("2020-01")).month).toBe("2026-08");
  });

  it("только свои сделки; отменённые не считаются; ожидается и в работе — как прежде", async () => {
    const mine = await makeDeal();
    const other = await makeDeal();
    const cancelled = await makeDeal({ executor: mine.executor });
    await advanceReceivedAt(mine, "2026-11-03T07:00:00Z");
    await advanceReceivedAt(other, "2026-11-04T07:00:00Z");
    await cancelDeal(cancelled.client, { dealId: cancelled.dealId, reason: "Передумали" }, noCancelHooks);

    const finance = await getExecutorFinance(mine.executor, { now });
    expect(finance.month).toMatchObject({ month: "2026-11", received: 50_000 });
    expect(finance.month.rows.map((r) => r.dealId)).toEqual([mine.dealId]);
    expect(finance.rows.some((r) => r.dealId === cancelled.dealId)).toBe(false);
    expect(finance.totals).toEqual({ received: 50_000, expected: 0, upcoming: 50_000 });
  });
});
