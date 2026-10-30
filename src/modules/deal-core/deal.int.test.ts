import { describe, expect, it } from "vitest";
import { DealStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import { db, transaction } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import {
  dealOf,
  makeDeal,
  makeStagePhoto,
  signAct,
  signContract,
  stagesOf,
  TEMPLATES,
  type DealFixture,
} from "../../../test/factories/deal";
import {
  acceptStage,
  cancelDeal,
  confirmStagePayment,
  createDeal,
  leaveReview,
  markStagePaid,
  openDispute,
  requestRework,
  startStage,
  submitStage,
} from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

async function submit(f: DealFixture, stageId: string) {
  await submitStage(f.executor, { stageId, report: "Готово, фото во вложении", photoIds: [await makeStagePhoto(f.executor)] });
}

/** Сделка в работе (manual, шаблон с авансом), аванс оплачен и подтверждён. */
async function startedDeal() {
  const f = await makeDeal();
  await signContract(f.dealId);
  const [first] = await stagesOf(f.dealId);
  await markStagePaid(f.client, { stageId: first.id });
  await confirmStagePayment(f.executor, { stageId: first.id });
  return f;
}

describe("создание сделки (createDeal)", () => {
  it("создаёт этапы и оплаты по шаблону, договор на подпись, запись в журнале и уведомления сторонам", async () => {
    const f = await makeDeal({ total: 100_001 });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: f.dealId }, include: { stages: { include: { payment: true }, orderBy: { order: "asc" } }, documents: true } });

    expect(deal).toMatchObject({ status: "AWAITING_SIGNATURES", paymentMode: "MANUAL", totalAmount: 100_001, autoAcceptDays: 5 });
    expect(deal.stages.map((s) => [s.amount, s.paymentDue, s.payment?.amount ?? null])).toEqual([
      [50_000, "ON_START", 50_000],
      [0, "ON_ACCEPTANCE", null],
      [50_001, "ON_ACCEPTANCE", 50_001],
    ]);
    expect(deal.documents.map((d) => [d.kind, d.status])).toEqual([["CONTRACT", "SIGNING"]]);
    expect(await db.auditEvent.count({ where: { scope: `deal:${f.dealId}`, action: "deal.created" } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "deal.contract.ready" } })).toBe(2);
  });

  it("отклоняет отклик чужой заявки и вторую сделку по той же заявке", async () => {
    const f = await makeDeal();
    const deal = await dealOf(f.dealId);
    const input = { requestId: f.requestId, offerId: deal.offerId, clientId: f.client.id, executorId: f.executor.executor.id, title: "x", totalAmount: 1000, template: TEMPLATES.single };
    expect(await code(transaction((tx) => createDeal(tx, input)))).toBe("CONFLICT");
    const other = await makeExecutor();
    expect(await code(transaction((tx) => createDeal(tx, { ...input, executorId: other.executor.id })))).toBe("VALIDATION");
  });
});

describe("полный путь сделки в режиме manual", () => {
  it("подпись → аванс → этапы с приёмкой, актами и оплатой → завершение → отзыв", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    expect((await dealOf(f.dealId)).status).toBe("IN_PROGRESS");

    const [advance, work, final] = await stagesOf(f.dealId);
    // Аванс: этап не начать, пока оплата не подтверждена
    expect(await code(startStage(f.executor, { stageId: advance.id }))).toBe("CONFLICT");
    await markStagePaid(f.client, { stageId: advance.id });
    expect(await code(startStage(f.executor, { stageId: advance.id }))).toBe("CONFLICT");
    await confirmStagePayment(f.executor, { stageId: advance.id });

    for (const stage of [advance, work, final]) {
      await startStage(f.executor, { stageId: stage.id });
      await submit(f, stage.id);
      await acceptStage(f.client, { stageId: stage.id });
      if (stage.id === final.id) {
        await markStagePaid(f.client, { stageId: stage.id });
        await confirmStagePayment(f.executor, { stageId: stage.id });
      }
      await signAct(stage.id);
    }

    const stages = await stagesOf(f.dealId);
    expect(stages.map((s) => [s.status, s.payment?.status ?? null])).toEqual([
      ["CLOSED", "CONFIRMED"],
      ["CLOSED", null],
      ["CLOSED", "CONFIRMED"],
    ]);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "COMPLETED" });

    await leaveReview(f.client, { dealId: f.dealId, rating: 5, text: "Отлично" });
    expect(await code(leaveReview(f.client, { dealId: f.dealId, rating: 4 }))).toBe("CONFLICT");
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id } })).toMatchObject({
      ratingAvg: 5,
      reviewsCount: 1,
      completedDeals: 1,
    });
    const actions = (await db.auditEvent.findMany({ where: { scope: `deal:${f.dealId}` }, orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["deal.signed", "deal.stage.accepted", "deal.stage.closed", "deal.completed", "review.created"]));
  });

  it("этап без подписанного акта или без подтверждённой оплаты не закрывается", async () => {
    const f = await startedDeal();
    const [advance, work] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: advance.id });
    await submit(f, advance.id);
    await acceptStage(f.client, { stageId: advance.id });
    expect((await stagesOf(f.dealId))[0].status).toBe("ACCEPTED");
    // следующий этап можно начать после приёмки, не дожидаясь акта
    await startStage(f.executor, { stageId: work.id });
    await signAct(advance.id);
    expect((await stagesOf(f.dealId))[0].status).toBe("CLOSED");
  });

  it("возврат на доработку и повторная сдача", async () => {
    const f = await startedDeal();
    const [advance] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: advance.id });
    await submit(f, advance.id);
    await requestRework(f.client, { stageId: advance.id, note: "Не хватает чеков" });
    expect((await stagesOf(f.dealId))[0]).toMatchObject({ status: "REWORK", reworkNote: "Не хватает чеков", autoAcceptAt: null });
    await submit(f, advance.id);
    expect((await stagesOf(f.dealId))[0].status).toBe("SUBMITTED");
  });

  it("отмена до начала работ — любой стороной; после начала — нельзя", async () => {
    const f = await makeDeal();
    await cancelDeal(f.executor, { dealId: f.dealId, reason: "Передумали" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "CANCELLED" });

    const g = await startedDeal();
    expect(await code(cancelDeal(g.client, { dealId: g.dealId }))).toBe("CONFLICT");
  });

  it("отзыв — только заказчик и только после завершения", async () => {
    const f = await startedDeal();
    expect(await code(leaveReview(f.client, { dealId: f.dealId, rating: 5 }))).toBe("CONFLICT");
    expect(await code(leaveReview(f.executor, { dealId: f.dealId, rating: 5 }))).toBe("FORBIDDEN");
  });
});

describe("гонки: двойной клик даёт один эффект", () => {
  it("две одновременные приёмки этапа — одна успешна, один акт, одно событие", async () => {
    const f = await startedDeal();
    const [advance] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: advance.id });
    await submit(f, advance.id);

    const results = await Promise.allSettled([acceptStage(f.client, { stageId: advance.id }), acceptStage(f.client, { stageId: advance.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.document.count({ where: { stageId: advance.id, kind: "STAGE_ACT" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "deal.stage.accepted", entityId: advance.id } })).toBe(1);
  });

  it("два одновременных «Получил оплату» — одно подтверждение", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    const [advance] = await stagesOf(f.dealId);
    await markStagePaid(f.client, { stageId: advance.id });
    const results = await Promise.allSettled([
      confirmStagePayment(f.executor, { stageId: advance.id }),
      confirmStagePayment(f.executor, { stageId: advance.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "deal.stage.payment.confirmed" } })).toBe(1);
  });

  it("спор и приёмка одновременно — проходит одно, состояние согласовано", async () => {
    const f = await startedDeal();
    const [advance] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: advance.id });
    await submit(f, advance.id);
    const results = await Promise.allSettled([
      acceptStage(f.client, { stageId: advance.id }),
      openDispute(f.executor, { dealId: f.dealId, reason: "PAYMENT", description: "Заказчик тянет с приёмкой" }),
    ]);
    const deal = await dealOf(f.dealId);
    const [stage] = await stagesOf(f.dealId);
    if (deal.status === "DISPUTE") expect(stage.status === "SUBMITTED" || stage.status === "ACCEPTED").toBe(true);
    else expect(stage.status).toBe("ACCEPTED");
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});

describe("доступ к чужим сделкам (IDOR)", () => {
  it("чужой заказчик и чужой исполнитель получают «не найдено», оператор не может действовать за стороны", async () => {
    const f = await startedDeal();
    const [advance] = await stagesOf(f.dealId);
    const stranger = await makeClient();
    const otherExecutor = await makeExecutor();
    const operator = await makeOperator();

    expect(await code(startStage(otherExecutor, { stageId: advance.id }))).toBe("NOT_FOUND");
    expect(await code(cancelDeal(stranger, { dealId: f.dealId }))).toBe("NOT_FOUND");
    expect(await code(startStage(operator, { stageId: advance.id }))).toBe("FORBIDDEN");
    await startStage(f.executor, { stageId: advance.id });
    await submit(f, advance.id);
    expect(await code(acceptStage(stranger, { stageId: advance.id }))).toBe("NOT_FOUND");
    expect(await code(acceptStage(f.executor, { stageId: advance.id }))).toBe("FORBIDDEN");
  });

  it("нельзя приложить к этапу чужое фото", async () => {
    const f = await startedDeal();
    const [advance] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: advance.id });
    const foreign = await makeStagePhoto(f.client);
    expect(await code(submitStage(f.executor, { stageId: advance.id, report: "Готово полностью", photoIds: [foreign] }))).toBe("CONFLICT");
    expect((await stagesOf(f.dealId))[0].status).toBe("IN_PROGRESS");
  });
});

describe("на реальной БД: каждое действие из каждого статуса", () => {
  type StageAction = { name: string; allowed: StageStatus[]; run: (f: DealFixture, stageId: string) => Promise<unknown> };
  const stageActions: StageAction[] = [
    { name: "начать", allowed: ["PENDING"], run: (f, id) => startStage(f.executor, { stageId: id }) },
    { name: "сдать", allowed: ["IN_PROGRESS", "REWORK"], run: (f, id) => submit(f, id) },
    { name: "вернуть на доработку", allowed: ["SUBMITTED"], run: (f, id) => requestRework(f.client, { stageId: id, note: "Исправить фасад" }) },
    { name: "принять", allowed: ["SUBMITTED"], run: (f, id) => acceptStage(f.client, { stageId: id }) },
  ];

  for (const action of stageActions) {
    for (const status of Object.values(StageStatus)) {
      const ok = action.allowed.includes(status);
      it(`этап: «${action.name}» из ${status} — ${ok ? "можно" : "нельзя"}`, async () => {
        const f = await startedDeal();
        const [advance] = await stagesOf(f.dealId);
        await db.stage.update({ where: { id: advance.id }, data: { status } });
        expect(await code(action.run(f, advance.id))).toBe(ok ? "OK" : "CONFLICT");
      });
    }
  }

  const paymentActions = [
    { name: "я оплатил", allowed: ["DUE"], run: (f: DealFixture, id: string) => markStagePaid(f.client, { stageId: id }) },
    { name: "получил оплату", allowed: ["MARKED_PAID"], run: (f: DealFixture, id: string) => confirmStagePayment(f.executor, { stageId: id }) },
  ] as const;
  for (const action of paymentActions) {
    for (const status of Object.values(StagePaymentStatus)) {
      const ok = (action.allowed as readonly string[]).includes(status);
      it(`оплата: «${action.name}» из ${status} — ${ok ? "можно" : "нельзя"}`, async () => {
        const f = await makeDeal();
        await signContract(f.dealId);
        const [advance] = await stagesOf(f.dealId);
        await db.stagePayment.update({ where: { stageId: advance.id }, data: { status } });
        expect(await code(action.run(f, advance.id))).toBe(ok ? "OK" : "CONFLICT");
      });
    }
  }

  const dealActions = [
    { name: "отменить", allowed: ["AWAITING_SIGNATURES", "AWAITING_DEPOSIT"], run: (f: DealFixture) => cancelDeal(f.client, { dealId: f.dealId }) },
    {
      name: "открыть спор",
      allowed: ["IN_PROGRESS"],
      run: (f: DealFixture) => openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Фасады с царапинами" }),
    },
  ] as const;
  for (const action of dealActions) {
    for (const status of Object.values(DealStatus)) {
      const ok = (action.allowed as readonly string[]).includes(status);
      it(`сделка: «${action.name}» из ${status} — ${ok ? "можно" : "нельзя"}`, async () => {
        const f = await makeDeal();
        await db.deal.update({ where: { id: f.dealId }, data: { status } });
        expect(await code(action.run(f))).toBe(ok ? "OK" : "CONFLICT");
      });
    }
  }
});
