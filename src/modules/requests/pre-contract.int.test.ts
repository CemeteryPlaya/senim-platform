import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeOperator, makeUser } from "../../../test/factories";
import { setEnv } from "../../../test/factories/identity";
import {
  attachRoomPhoto,
  inDays,
  makeApprovedProject,
  makeChosen,
  makeDraft,
  makeExecutorWithTerms,
  makeMeasuring,
  makeOpenRequest,
  offerInput,
  projectInput,
  withFlow,
} from "../../../test/factories/requests";
import {
  activePreContractFlow,
  agreeToContract,
  approveProject,
  assignSiteMeasurer,
  chooseOffer,
  completeMeasurement,
  completeSiteMeasurement,
  confirmDeposit,
  getClientRequest,
  getIncomingRequest,
  getSiteMeasurement,
  listIncomingRequests,
  markDepositPaid,
  publishRequest,
  requestProjectChanges,
  scheduleMeasurement,
  sendOffer,
  setPreContractFlow,
  submitProject,
} from "./index";

const code = (c: string) => expect.objectContaining({ code: c });
const statusOf = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).status;
const one = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "fulfilled").length;

afterEach(() => setEnv({ DEMO_MODE: undefined }));

describe("настройка «Сценарий до договора»", () => {
  it("меняет только оператор и только в демо-режиме; смена пишется в журнал", async () => {
    const operator = await makeOperator();
    const client = await makeClient();
    setEnv({ DEMO_MODE: "false" });
    await expect(setPreContractFlow(operator, { flow: "SELF_MEASURE" })).rejects.toThrow(code("FORBIDDEN"));

    setEnv({ DEMO_MODE: "true" });
    await expect(setPreContractFlow(client, { flow: "SELF_MEASURE" })).rejects.toThrow(code("FORBIDDEN"));
    expect(await activePreContractFlow()).toBe("EXECUTOR_MEASURE");
    await setPreContractFlow(operator, { flow: "SELF_MEASURE" });
    await setPreContractFlow(operator, { flow: "SELF_MEASURE" }); // повтор ничего не пишет
    expect(await activePreContractFlow()).toBe("SELF_MEASURE");
    const events = await db.auditEvent.findMany({ where: { action: "requests.pre_contract_flow.switched" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ before: { flow: "EXECUTOR_MEASURE" }, after: { flow: "SELF_MEASURE" } });
  });

  it("заявка запоминает сценарий при отправке: смена настройки не меняет идущие заявки", async () => {
    await withFlow("CONTRACT_FIRST");
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    await withFlow("MEASURE_DEPOSIT");
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).preContractFlow).toBe("CONTRACT_FIRST");
    expect((await getClientRequest(client, requestId)).pre.flow).toBe("CONTRACT_FIRST");
  });
});

describe("утверждение проекта (сценарий 1)", () => {
  it("согласие на договор — только после утверждения; цена договора — цена проекта", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await expect(submitProject(m.executor, projectInput(m.offerId))).rejects.toThrow(code("CONFLICT")); // замер ещё не выполнен
    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 600_000, result: "" });
    await expect(agreeToContract(client, { requestId: m.requestId, template: "advance-50" })).rejects.toThrow(code("CONFLICT"));

    const { projectId } = await submitProject(m.executor, projectInput(m.offerId, 650_000));
    expect((await getClientRequest(client, m.requestId)).pre.current).toBe("project");
    await expect(agreeToContract(client, { requestId: m.requestId, template: "advance-50" })).rejects.toThrow(code("CONFLICT"));
    await approveProject(client, { projectId });
    expect((await getClientRequest(client, m.requestId)).pre.current).toBe("contract");

    const { dealId } = await agreeToContract(client, { requestId: m.requestId, template: "advance-50" });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { stages: { orderBy: { order: "asc" } } } });
    expect(deal.totalAmount).toBe(650_000);
    expect(deal.stages[0]!.title).toBe("Аванс на материалы"); // сценарий 1: этапы шаблона без изменений
    expect(await db.auditEvent.count({ where: { action: { in: ["project.submitted", "project.approved"] } } })).toBe(2);
  });

  it("«Внести изменения» → новая версия → утверждение; переходы из неверного статуса — CONFLICT", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 600_000, result: "" });
    const v1 = await submitProject(m.executor, projectInput(m.offerId));
    await expect(submitProject(m.executor, projectInput(m.offerId))).rejects.toThrow(code("CONFLICT")); // v1 ждёт решения

    await requestProjectChanges(client, { projectId: v1.projectId, comment: "Фасады светлее, позвоните +7 701 123 45 67" });
    const changed = await db.project.findUniqueOrThrow({ where: { id: v1.projectId } });
    expect(changed.status).toBe("CHANGES_REQUESTED");
    expect(changed.changeNote).not.toContain("701 123 45 67"); // контакты в комментарии маскируются
    await expect(approveProject(client, { projectId: v1.projectId })).rejects.toThrow(code("CONFLICT"));

    const v2 = await submitProject(m.executor, projectInput(m.offerId, 620_000));
    expect((await db.project.findUniqueOrThrow({ where: { id: v2.projectId } })).version).toBe(2);
    await approveProject(client, { projectId: v2.projectId });
    await expect(requestProjectChanges(client, { projectId: v2.projectId, comment: "Ещё" })).rejects.toThrow(code("CONFLICT"));
    await expect(submitProject(m.executor, projectInput(m.offerId))).rejects.toThrow(code("CONFLICT")); // уже утверждён
  });

  it("гонки: две отправки версии и два «Утвердить» — по одному успеху", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 600_000, result: "" });
    const sent = await Promise.allSettled([submitProject(m.executor, projectInput(m.offerId)), submitProject(m.executor, projectInput(m.offerId))]);
    expect(one(sent)).toBe(1);
    const project = await db.project.findFirstOrThrow({ where: { offerId: m.offerId } });
    const approved = await Promise.allSettled([approveProject(client, { projectId: project.id }), approveProject(client, { projectId: project.id })]);
    expect(one(approved)).toBe(1);
    expect(await db.project.count({ where: { offerId: m.offerId } })).toBe(1);
  });

  it("IDOR: чужой заказчик и не выбранный исполнитель проект не видят и не меняют", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 600_000, result: "" });
    const { projectId } = await submitProject(m.executor, projectInput(m.offerId));
    const stranger = await makeClient();
    const otherExecutor = await makeExecutorWithTerms("COMFORT");
    await expect(approveProject(stranger, { projectId })).rejects.toThrow(code("NOT_FOUND"));
    await expect(requestProjectChanges(stranger, { projectId, comment: "Чужое" })).rejects.toThrow(code("NOT_FOUND"));
    await expect(submitProject(otherExecutor, projectInput(m.offerId))).rejects.toThrow(code("NOT_FOUND"));
    await expect(approveProject(m.executor, { projectId })).rejects.toThrow(code("FORBIDDEN"));
  });
});

describe("сценарий 2: замерщик площадки", () => {
  async function platformRequest() {
    await withFlow("PLATFORM_MEASURER");
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const operator = await makeOperator();
    const measurer = await makeUser("MEASURER", "Замерщик Нуржан");
    const executor = await makeExecutorWithTerms("COMFORT");
    return { client, requestId, operator, measurer, executor };
  }

  it("заявка ждёт замерщика и не видна исполнителям; после замера — открыта, размеры видят исполнители", async () => {
    const { client, requestId, operator, measurer, executor } = await platformRequest();
    expect(await statusOf(requestId)).toBe("PLATFORM_MEASURING");
    expect(await listIncomingRequests(executor)).toHaveLength(0);
    await expect(sendOffer(executor, offerInput(requestId))).rejects.toThrow(code("NOT_FOUND"));

    await expect(assignSiteMeasurer(client, { requestId, measurerId: measurer.id })).rejects.toThrow(code("FORBIDDEN"));
    await expect(assignSiteMeasurer(operator, { requestId, measurerId: client.id })).rejects.toThrow(code("NOT_FOUND")); // не замерщик
    const assigned = await Promise.allSettled([
      assignSiteMeasurer(operator, { requestId, measurerId: measurer.id }),
      assignSiteMeasurer(operator, { requestId, measurerId: measurer.id }),
    ]);
    expect(one(assigned)).toBe(1);
    const sm = await db.siteMeasurement.findUniqueOrThrow({ where: { requestId } });

    const otherMeasurer = await makeUser("MEASURER", "Другой замерщик");
    await expect(getSiteMeasurement(otherMeasurer, sm.id)).rejects.toThrow(code("NOT_FOUND"));
    const input = { siteMeasurementId: sm.id, widthCm: 320, heightCm: 260, depthCm: 60, notes: "Труба в углу", photoFileIds: [] };
    await expect(completeSiteMeasurement(otherMeasurer, input)).rejects.toThrow(code("NOT_FOUND"));
    const done = await Promise.allSettled([completeSiteMeasurement(measurer, input), completeSiteMeasurement(measurer, input)]);
    expect(one(done)).toBe(1);

    expect(await statusOf(requestId)).toBe("OPEN");
    expect(await listIncomingRequests(executor)).toHaveLength(1);
    const incoming = await getIncomingRequest(executor, requestId);
    expect(incoming.pre.site).toMatchObject({ status: "DONE", widthCm: 320, notes: "Труба в углу" });
    expect(await db.notification.count({ where: { userId: executor.id, kind: "request.new" } })).toBe(1);
  });

  it("после выбора — проект и договор без выезда исполнителя; первый этап — контрольный замер", async () => {
    const { client, requestId, operator, measurer, executor } = await platformRequest();
    await assignSiteMeasurer(operator, { requestId, measurerId: measurer.id });
    const sm = await db.siteMeasurement.findUniqueOrThrow({ where: { requestId } });
    await completeSiteMeasurement(measurer, { siteMeasurementId: sm.id, widthCm: 300, heightCm: 250, depthCm: null, notes: "", photoFileIds: [] });
    const { offerId } = await sendOffer(executor, offerInput(requestId, 700_000));
    await chooseOffer(client, { offerId });
    await expect(scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) })).rejects.toThrow(code("CONFLICT"));
    await makeApprovedProject(client, executor, offerId, 710_000);

    const { dealId } = await agreeToContract(client, { requestId, template: "advance-50" });
    const stages = await db.stage.findMany({ where: { dealId }, orderBy: { order: "asc" } });
    expect(stages[0]).toMatchObject({ title: "Контрольный замер", amount: 0 });
    expect(stages.reduce((s, x) => s + x.amount, 0)).toBe(710_000);
  });
});

describe("сценарий 3: договор до замера", () => {
  it("согласие сразу после выбора по цене отклика; проект после договора — в пределах ±15 %", async () => {
    await withFlow("CONTRACT_FIRST");
    const client = await makeClient();
    const { requestId, executor, offerId } = await makeChosen(client); // цена отклика 500 000
    await expect(submitProject(executor, projectInput(offerId))).rejects.toThrow(code("CONFLICT")); // до договора проекта нет

    const { dealId } = await agreeToContract(client, { requestId, template: "advance-50" });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { stages: { orderBy: { order: "asc" } } } });
    expect(deal.totalAmount).toBe(500_000);
    expect(deal.stages[0]).toMatchObject({ title: "Замер и проект", amount: 50_000 });

    await expect(submitProject(executor, projectInput(offerId, 575_001))).rejects.toThrow(code("VALIDATION"));
    await expect(submitProject(executor, projectInput(offerId, 424_999))).rejects.toThrow(code("VALIDATION"));
    const { projectId } = await submitProject(executor, projectInput(offerId, 575_000));
    await approveProject(client, { projectId });
    expect((await getClientRequest(client, requestId)).pre).toMatchObject({ current: "contract", tolerance: { price: 500_000, min: 425_000, max: 575_000 } });
  });
});

describe("сценарий 4: залог за выезд", () => {
  it("замер — после отметки заказчика и подтверждения исполнителя; повторы — CONFLICT; чужие — нет", async () => {
    await withFlow("MEASURE_DEPOSIT");
    const client = await makeClient();
    const { executor, offerId } = await makeChosen(client);
    await expect(scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) })).rejects.toThrow(code("CONFLICT"));
    await expect(confirmDeposit(executor, { offerId })).rejects.toThrow(code("CONFLICT")); // заказчик ещё не отметил
    await expect(markDepositPaid(await makeClient(), { offerId })).rejects.toThrow(code("NOT_FOUND"));

    const marked = await Promise.allSettled([markDepositPaid(client, { offerId }), markDepositPaid(client, { offerId })]);
    expect(one(marked)).toBe(1);
    await expect(confirmDeposit(await makeExecutorWithTerms("COMFORT"), { offerId })).rejects.toThrow(code("NOT_FOUND"));
    const confirmed = await Promise.allSettled([confirmDeposit(executor, { offerId }), confirmDeposit(executor, { offerId })]);
    expect(one(confirmed)).toBe(1);
    expect(await db.measureDeposit.findUniqueOrThrow({ where: { offerId } })).toMatchObject({ status: "CONFIRMED", amount: 10_000 });

    await scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) });
  });

  it("в других сценариях залога нет", async () => {
    const client = await makeClient();
    const { offerId } = await makeChosen(client);
    await expect(markDepositPaid(client, { offerId })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("сценарий 5: онлайн-замер", () => {
  it("без трёх размеров и фото с рулеткой заявка не отправляется; договор — с контрольным замером первым этапом", async () => {
    await withFlow("SELF_MEASURE");
    const client = await makeClient();
    const requestId = await makeDraft(client);
    await expect(publishRequest(client, { requestId })).rejects.toThrow(code("VALIDATION")); // фото нет
    await attachRoomPhoto(requestId, client.id);
    await publishRequest(client, { requestId });
    expect(await statusOf(requestId)).toBe("OPEN");

    const executor = await makeExecutorWithTerms("COMFORT");
    const { offerId } = await sendOffer(executor, offerInput(requestId));
    await chooseOffer(client, { offerId });
    await makeApprovedProject(client, executor, offerId, 480_000);
    const { dealId } = await agreeToContract(client, { requestId, template: "no-prepayment" });
    const first = await db.stage.findFirstOrThrow({ where: { dealId }, orderBy: { order: "asc" } });
    expect(first.title).toBe("Контрольный замер");
    expect(first.description).toContain("5 %");
  });
});
