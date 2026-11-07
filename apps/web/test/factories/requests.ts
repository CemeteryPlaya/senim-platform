import { afterEach, beforeEach } from "vitest";
import type { MeasurementTerms, PreContractFlow, Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import {
  acceptPrice,
  approveProject,
  chooseOffer,
  completeMeasurement,
  publishRequest,
  saveDraftStep,
  scheduleMeasurement,
  sendOffer,
  setPreContractFlow,
  submitProject,
  type StepInput,
} from "@/modules/requests";
import { db } from "@/platform/db";
import { makeExecutor, makeUser } from "../factories";
import { setEnv } from "./identity";

/**
 * Фабрики заявок строят состояние через сервис requests — так же, как это делает пользователь.
 * Прямые записи в БД — только для справочников и чужих модулей (портфолио).
 */

let typeSeq = 0;

export async function makeFurnitureType(name = "Кухня") {
  typeSeq += 1;
  return db.furnitureType.create({ data: { slug: `type-${typeSeq}`, name } });
}

export type DraftOpts = { segment?: Segment; like?: string; typeId?: string };

export function segmentStep(segment: Segment = "COMFORT"): StepInput {
  return { screen: "segment", segment };
}

/** Байтерек (Астана): точка адреса заявки. */
export const POINT = { lat: 51.128207, lng: 71.430411 };
export const placeStep: StepInput = { screen: "place", city: "Астана", address: "ул. Тестовая, 1, кв. 2", desiredDate: null, location: POINT };

/** Заполненный мастер (все экраны, «Для продвинутых» открыт), но ещё не отправленный. */
export async function makeDraft(client: CurrentUser, opts: DraftOpts = {}): Promise<string> {
  const typeId = opts.typeId ?? (await makeFurnitureType()).id;
  const steps: StepInput[] = [
    {
      screen: "start",
      furnitureTypeId: typeId,
      customType: null,
      style: "modern",
      advanced: { size: { mode: "known", widthCm: 300, heightCm: 250, depthCm: 60 }, facade: "mdf_film", countertop: "unknown", hardware: "soft_close" },
    },
    segmentStep(opts.segment),
    { screen: "room", photoFileIds: [], description: "" },
    placeStep,
    { screen: "send" },
  ];
  let requestId: string | null = null;
  for (const step of steps) {
    const saved: { requestId: string } = await saveDraftStep(client, { requestId, like: requestId ? null : (opts.like ?? null), step });
    requestId = saved.requestId;
  }
  return requestId!;
}

export async function makeOpenRequest(client: CurrentUser, opts: DraftOpts = {}): Promise<string> {
  const requestId = await makeDraft(client, opts);
  await publishRequest(client, { requestId });
  return requestId;
}

export async function makeExecutorWithTerms(segment: Segment, terms: MeasurementTerms = "FREE", fee: number | null = null) {
  const executor = await makeExecutor({ segment });
  await db.executorProfile.update({ where: { id: executor.executor.id }, data: { measurementTerms: terms, measurementFee: fee } });
  return executor;
}

/** Отклик; цена — в тенге (в БД — тиыны). */
export const offerInput = (requestId: string, priceKzt = 500_000, extra: { durationDays?: number; warrantyMonths?: number } = {}) => ({
  requestId,
  priceKzt,
  durationDays: extra.durationDays ?? 30,
  warrantyMonths: extra.warrantyMonths ?? 24,
  comment: "",
});

/** Открытое предложение цены по отклику (после отправки — цена отклика от мастера). */
export const openProposal = (offerId: string) => db.priceProposal.findFirstOrThrow({ where: { offerId, status: "PROPOSED" } });

/** Путь ТЗ: заявка, отклик мастера и акцепт его цены покупателем — заявка CONTRACTING, сделка с офертой создана. */
export async function makeAccepted(client: CurrentUser, priceKzt = 500_000) {
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutorWithTerms("COMFORT");
  const { offerId } = await sendOffer(executor, offerInput(requestId, priceKzt));
  const { dealId } = await acceptPrice(client, { proposalId: (await openProposal(offerId)).id });
  return { requestId, executor, offerId, dealId };
}

/**
 * Сценарии до договора (флаг preContractFlows) в тестах файла или describe: флаг включён перед каждым тестом,
 * после — флаг и DEMO_MODE сброшены (env процесса общий для файла).
 */
export function withPreContractFlows(): void {
  beforeEach(() => setEnv({ FEATURE_PRE_CONTRACT_FLOWS: "true" }));
  afterEach(() => setEnv({ FEATURE_PRE_CONTRACT_FLOWS: undefined, DEMO_MODE: undefined }));
}

/** Флаг на время одного вызова (тест «в обоих положениях флага»). */
export async function withFeature<T>(name: "FEATURE_PRE_CONTRACT_FLOWS" | "FEATURE_MATERIALS_CALCULATOR", on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[name];
  setEnv({ [name]: on ? "true" : "false" });
  try {
    return await fn();
  } finally {
    setEnv({ [name]: prev });
  }
}

/** Открытая заявка с выбранным откликом исполнителя (по умолчанию — 10 000 ₸ за выезд). Нужен флаг preContractFlows. */
export async function makeChosen(client: CurrentUser, terms: MeasurementTerms = "FEE_IF_NO_DEAL") {
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutorWithTerms("COMFORT", terms, terms === "FEE_IF_NO_DEAL" ? 10_000 : null);
  const { offerId } = await sendOffer(executor, offerInput(requestId));
  await chooseOffer(client, { offerId });
  return { requestId, executor, offerId };
}

export const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000);

export async function makeMeasuring(client: CurrentUser, terms: MeasurementTerms = "FEE_IF_NO_DEAL") {
  const chosen = await makeChosen(client, terms);
  const { measurementId } = await scheduleMeasurement(chosen.executor, { offerId: chosen.offerId, scheduledAt: inDays(2) });
  return { ...chosen, measurementId };
}

/** Проект на сумму `total` одной строкой расшифровки. */
export const projectInput = (offerId: string, total = 600_000) => ({
  offerId,
  materials: "ЛДСП Egger 16 мм, фасады МДФ в плёнке, фурнитура Blum",
  costLines: [{ title: "Изготовление и монтаж", amount: total }],
  durationDays: 30,
  warrantyMonths: 24,
  totalPrice: total,
});

/** Исполнитель отправляет проект, заказчик утверждает (ADR-005). */
export async function makeApprovedProject(client: CurrentUser, executor: CurrentUser, offerId: string, total = 600_000) {
  const { projectId } = await submitProject(executor, projectInput(offerId, total));
  await approveProject(client, { projectId });
  return projectId;
}

/** Замер выполнен, проект на итоговую цену утверждён: заявка готова к согласию на договор (сценарий 1). */
export async function makeMeasured(client: CurrentUser, finalPrice = 600_000) {
  const m = await makeMeasuring(client);
  await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice, result: "Замер выполнен" });
  const projectId = await makeApprovedProject(client, m.executor, m.offerId, finalPrice);
  return { ...m, projectId };
}

/** Сценарий до договора для следующих заявок (ADR-005): DEMO_MODE и настройка площадки от имени оператора. */
export async function withFlow(flow: PreContractFlow): Promise<void> {
  setEnv({ DEMO_MODE: "true" });
  const operator = await makeUser("OPERATOR", "Оператор сценария");
  await setPreContractFlow(operator, { flow });
}

/** Фото помещения, прикреплённое к заявке (как после загрузки в мастере или замерщиком). */
export async function attachRoomPhoto(requestId: string, uploadedById: string) {
  return db.storedFile.create({
    data: {
      storageKey: `test/room/${requestId}/${Math.random().toString(36).slice(2)}.jpg`,
      provider: "local",
      purpose: "REQUEST_ROOM",
      contentType: "image/jpeg",
      size: 1000,
      sha256: "0".repeat(64),
      uploadedById,
      requestId,
    },
  });
}
