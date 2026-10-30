import type { DealStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../factories";

/**
 * Фабрики зоны companies: типы мебели, работы портфолио, «нить» заявка → отклик → сделка для чата и отзывов.
 * Заявки и сделки создаются напрямую через Prisma: тестам companies не нужна логика requests и deal-core.
 */
type Executor = Awaited<ReturnType<typeof makeExecutor>>;

let n = 0;

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
      price: 900_000,
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
          totalAmount: 900_000,
          paymentMode: "MANUAL",
          status: opts.dealStatus,
          stageTemplate: "no-prepayment",
          autoAcceptDays: 5,
        },
      })
    : null;
  return { client, executor, requestId: request.id, offerId: offer.id, dealId: deal?.id ?? null };
}

/** Завершённая сделка с отзывом заказчика. */
export async function makeReview(executor: Executor, rating: number, text = "") {
  const thread = await makeOfferThread({ executor, dealStatus: "COMPLETED", requestStatus: "CLOSED" });
  return db.review.create({
    data: { dealId: thread.dealId!, executorId: executor.executor.id, authorId: thread.client.id, rating, text },
  });
}
