import type { MeasurementTerms, Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import {
  chooseOffer,
  completeMeasurement,
  publishRequest,
  saveDraftStep,
  scheduleMeasurement,
  sendOffer,
  type StepInput,
} from "@/modules/requests";
import { db } from "@/platform/db";
import { makeExecutor } from "../factories";

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

export function sendStep(segment: Segment = "COMFORT"): StepInput {
  return { screen: "send", segment, city: "Астана", address: "ул. Тестовая, 1, кв. 2", desiredDate: null, wishes: "" };
}

/** Заполненный мастер (все шесть экранов), но ещё не отправленный. */
export async function makeDraft(client: CurrentUser, opts: DraftOpts = {}): Promise<string> {
  const typeId = opts.typeId ?? (await makeFurnitureType()).id;
  const steps: StepInput[] = [
    { screen: "type", furnitureTypeId: typeId, customType: null },
    { screen: "style", style: "modern", styleNote: "" },
    { screen: "room", photoFileIds: [] },
    { screen: "size", size: { mode: "known", widthCm: 300, heightCm: 250, depthCm: 60 } },
    { screen: "materials", facade: "mdf_film", countertop: "unknown", hardware: "soft_close", color: "", extras: [], description: "" },
    sendStep(opts.segment),
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

export const offerInput = (requestId: string, price = 500_000, extra: { durationDays?: number; warrantyMonths?: number } = {}) => ({
  requestId,
  price,
  durationDays: extra.durationDays ?? 30,
  warrantyMonths: extra.warrantyMonths ?? 24,
  comment: "",
});

/** Открытая заявка с выбранным откликом исполнителя (по умолчанию — 10 000 ₸ за выезд). */
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

export async function makeMeasured(client: CurrentUser, finalPrice = 600_000) {
  const m = await makeMeasuring(client);
  await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice, result: "Замер выполнен" });
  return m;
}
