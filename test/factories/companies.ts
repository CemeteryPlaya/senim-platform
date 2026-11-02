import type { DealStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { FEATURE_ENV, type FeatureKey } from "@/platform/features";
import { makeClient, makeExecutor } from "../factories";

/**
 * Фабрики зоны companies: типы мебели, работы портфолио, «нить» заявка → отклик → сделка для чата и отзывов.
 * Заявки и сделки создаются напрямую через Prisma: тестам companies не нужна логика requests и deal-core.
 */
type Executor = Awaited<ReturnType<typeof makeExecutor>>;

/** Временно включает или выключает флаг (env + сброс кэша env); прежнее значение возвращается и при ошибке. */
export async function withFeature<T>(key: FeatureKey, on: boolean, fn: () => Promise<T>): Promise<T> {
  const name = FEATURE_ENV[key];
  const prev = process.env[name];
  process.env[name] = on ? "true" : "false";
  resetEnvCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
    resetEnvCache();
  }
}

let n = 0;
/** 900 000 ₸ в тиынах. */
export const PRICE_TIYN = 900_000_00n;

export async function makeFurnitureType(opts: { slug?: string; name?: string; active?: boolean } = {}) {
  n += 1;
  return db.furnitureType.create({
    data: { slug: opts.slug ?? `type-${n}`, name: opts.name ?? `Тип ${n}`, active: opts.active ?? true, sortOrder: n },
  });
}

export async function makePortfolioItem(
  executor: Executor,
  opts: { furnitureTypeId?: string; style?: string; title?: string; description?: string; priceFrom?: number | null; published?: boolean; photo?: boolean } = {},
) {
  n += 1;
  const furnitureTypeId = opts.furnitureTypeId ?? (await makeFurnitureType()).id;
  return db.portfolioItem.create({
    data: {
      executorId: executor.executor.id,
      furnitureTypeId,
      style: opts.style ?? "modern",
      title: opts.title ?? `Работа ${n}`,
      description: opts.description ?? "",
      priceFrom: opts.priceFrom === undefined ? 500_000 : opts.priceFrom,
      published: opts.published ?? true,
      photos:
        opts.photo === false
          ? undefined
          : {
              create: {
                storageKey: `demo/portfolio/test-${n}.svg`,
                provider: "static",
                purpose: "PORTFOLIO",
                contentType: "image/svg+xml",
                size: 100,
                sha256: "0".repeat(64),
                uploadedById: executor.id,
              },
            },
    },
  });
}

/** Файл, загруженный пользователем и ещё ни к чему не привязанный (как после uploader). */
export async function makeUploadedFile(user: CurrentUser, purpose: "PORTFOLIO" | "MESSAGE" = "PORTFOLIO") {
  n += 1;
  return db.storedFile.create({
    data: {
      storageKey: `${purpose.toLowerCase()}/test/${n}.jpg`,
      provider: "local",
      purpose,
      contentType: "image/jpeg",
      size: 1000,
      sha256: "1".repeat(64),
      uploadedById: user.id,
    },
  });
}

/** Заявка с откликом исполнителя (и сделкой, если задан dealStatus): основа чата и отзывов. */
export async function makeOfferThread(
  opts: {
    client?: CurrentUser;
    executor?: Executor;
    offerStatus?: OfferStatus;
    requestStatus?: RequestStatus;
    dealStatus?: DealStatus;
    /** Оферта заключена (Deal.signedAt): открывает контакты сторон. По умолчанию — для сделок после CREATED. */
    signed?: boolean;
  } = {},
) {
  const client = opts.client ?? (await makeClient());
  const executor = opts.executor ?? (await makeExecutor());
  const request = await db.request.create({
    data: { clientId: client.id, mode: "TENDER", status: opts.requestStatus ?? "OPEN", segment: "COMFORT", publishedAt: new Date() },
  });
  const offer = await db.offer.create({
    data: {
      requestId: request.id,
      executorId: executor.executor.id,
      priceTiyn: PRICE_TIYN,
      durationDays: 20,
      warrantyMonths: 24,
      measurementTerms: "FREE",
      status: opts.offerStatus ?? (opts.dealStatus ? "ACCEPTED" : "SENT"),
    },
  });
  const deal = opts.dealStatus
    ? await db.deal.create({
        data: {
          requestId: request.id,
          offerId: offer.id,
          clientId: client.id,
          executorId: executor.executor.id,
          title: "Кухня",
          ...computeDealMoney(PRICE_TIYN),
          durationDays: 20,
          warrantyMonths: 24,
          paymentProvider: "MOCK",
          status: opts.dealStatus,
          signedAt: (opts.signed ?? opts.dealStatus !== "CREATED") ? new Date() : null,
        },
      })
    : null;
  return { client, executor, requestId: request.id, offerId: offer.id, dealId: deal?.id ?? null };
}

/** Завершённая сделка с отзывом заказчика. */
export async function makeReview(executor: Executor, rating: number, text = "") {
  const thread = await makeOfferThread({ executor, dealStatus: "SPLIT_PAYOUT", requestStatus: "CLOSED" });
  return db.review.create({
    data: { dealId: thread.dealId!, executorId: executor.executor.id, authorId: thread.client.id, rating, text },
  });
}

/**
 * Завершённая сделка с фото: фото сдачи мастера (DELIVERY) — итоговые, и одно фото «Хода работ» (PROGRESS_REPORT).
 * Заявка — с типом мебели, стилем и городом (их подставляет форма «Добавить в портфолио»).
 */
export async function makeDealWithReport(opts: { client?: CurrentUser; executor?: Executor; dealStatus?: DealStatus; photos?: number } = {}) {
  const executor = opts.executor ?? (await makeExecutor());
  const thread = await makeOfferThread({ client: opts.client, executor, dealStatus: opts.dealStatus ?? "SPLIT_PAYOUT", requestStatus: "CLOSED" });
  const type = await makeFurnitureType({ name: "Кухня" });
  await db.request.update({ where: { id: thread.requestId }, data: { furnitureTypeId: type.id, style: "scandi", city: "Астана", address: "ул. Тестовая, 1, кв. 2" } });
  const dealId = thread.dealId!;
  const photo = async (purpose: "DELIVERY" | "PROGRESS_REPORT", owner: { dealId: string } | { progressReportId: string }, sortOrder = 0) => {
    n += 1;
    const file = await db.storedFile.create({
      data: { storageKey: `${purpose.toLowerCase()}/test/${n}.jpg`, provider: "local", purpose, contentType: "image/jpeg", size: 1000, sha256: "2".repeat(64), uploadedById: executor.id, sortOrder, ...owner },
    });
    return file.id;
  };
  const report = await db.progressReport.create({ data: { dealId, authorId: executor.id, title: "Изготовление", text: "Корпус готов" } });
  const earlierPhotoId = await photo("PROGRESS_REPORT", { progressReportId: report.id });
  const finalPhotoIds: string[] = [];
  for (let i = 0; i < (opts.photos ?? 2); i++) finalPhotoIds.push(await photo("DELIVERY", { dealId }, i));
  return { ...thread, executor, dealId, furnitureTypeId: type.id, finalPhotoIds, earlierPhotoId };
}
