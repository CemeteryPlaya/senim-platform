import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { publicExecutorView, publicExecutorViews, sanitizeExecutorText } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { auditByUser, links, loadExecutor, loadOwnRequest, requestTitle, requireClient } from "./access";
import { executorPortfolio, executorReviews, roomPhotos } from "./adapters";
import { parseDetails, type OfferSort, type SendOfferInput } from "./schema";
import { sortOffers } from "./sort";
import { OFFER_TRANSITIONS, REQUEST_TRANSITIONS, transition } from "./transitions";
import { visibleToExecutor } from "./visibility";

const e = ru.requests.errors;
const n = ru.requests.notify;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Отклик на видимую открытую заявку. Один на исполнителя: повтор и гонка — CONFLICT. */
export async function sendOffer(user: CurrentUser, input: SendOfferInput): Promise<{ offerId: string }> {
  try {
    return await transaction(async (tx) => {
      const executor = await loadExecutor(tx, user);
      const r = await tx.request.findFirst({
        where: { id: input.requestId, ...visibleToExecutor(executor) },
        include: { furnitureType: { select: { name: true } } },
      });
      if (!r) return fail.notFound(e.notFound);

      // Второй отклик того же исполнителя упирается в уникальный индекс (requestId, executorId) → CONFLICT ниже.
      const terms = input.measurementTerms ?? executor.measurementTerms;
      const fee = terms === "FEE_IF_NO_DEAL" ? (input.measurementTerms ? input.measurementFee : executor.measurementFee) : null;
      const offer = await tx.offer.create({
        data: {
          requestId: r.id,
          executorId: executor.id,
          price: input.price,
          durationDays: input.durationDays,
          warrantyMonths: input.warrantyMonths,
          comment: input.comment ? (await sanitizeExecutorText(tx, executor.id, input.comment)).text : input.comment,
          measurementTerms: terms,
          measurementFee: fee ?? null,
        },
      });
      await auditByUser(tx, user, r.id, {
        action: "offer.sent",
        entity: { type: "offer", id: offer.id },
        after: { status: offer.status, price: offer.price, durationDays: offer.durationDays, measurementTerms: terms },
      });
      const title = requestTitle(r);
      await notify(tx, {
        userId: r.clientId,
        kind: "offer.received",
        title: n.offerReceived.title,
        body: n.offerReceived.body(title, executor.publicNumber),
        link: links.client(r.id),
      });
      return { offerId: offer.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict(e.offerExists);
    throw err;
  }
}

/** Исполнитель отзывает свой отклик до выбора: SENT → WITHDRAWN. */
export async function withdrawOffer(user: CurrentUser, input: { offerId: string }): Promise<void> {
  await transaction(async (tx) => {
    const executor = await loadExecutor(tx, user);
    const offer = await tx.offer.findFirst({
      where: { id: input.offerId, executorId: executor.id },
      include: { request: { include: { furnitureType: { select: { name: true } } } } },
    });
    if (!offer) return fail.notFound(e.offerNotFound);
    const to = transition(OFFER_TRANSITIONS, "withdraw", offer.status, "EXECUTOR");
    if (offer.request.status !== "OPEN") fail.conflict();
    expectOneUpdated(await tx.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: to } }));
    await auditByUser(tx, user, offer.requestId, {
      action: "offer.withdrawn",
      entity: { type: "offer", id: offer.id },
      before: { status: offer.status },
      after: { status: to },
    });
    await notify(tx, {
      userId: offer.request.clientId,
      kind: "offer.withdrawn",
      title: n.offerWithdrawn.title,
      body: n.offerWithdrawn.body(requestTitle(offer.request), executor.publicNumber),
      link: links.client(offer.requestId),
    });
  });
}

/** OPEN → OFFER_CHOSEN: выбранный отклик ACCEPTED, остальные отправленные — DECLINED. */
export async function chooseOffer(user: CurrentUser, input: { offerId: string }): Promise<void> {
  requireClient(user);
  await transaction(async (tx) => {
    const offer = await tx.offer.findFirst({
      where: { id: input.offerId, request: { clientId: user.id } },
      include: { executor: { select: { userId: true } } },
    });
    if (!offer) return fail.notFound(e.offerNotFound);
    const r = await loadOwnRequest(tx, user, offer.requestId);
    const requestTo = transition(REQUEST_TRANSITIONS, "chooseOffer", r.status, "CLIENT");
    const offerTo = transition(OFFER_TRANSITIONS, "accept", offer.status, "CLIENT");

    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: requestTo } }));
    expectOneUpdated(await tx.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: offerTo } }));
    const others = await tx.offer.findMany({
      where: { requestId: r.id, status: "SENT", id: { not: offer.id } },
      select: { id: true, executor: { select: { userId: true } } },
    });
    const declinedTo = transition(OFFER_TRANSITIONS, "decline", "SENT", "CLIENT");
    await tx.offer.updateMany({ where: { id: { in: others.map((o) => o.id) }, status: "SENT" }, data: { status: declinedTo } });

    await auditByUser(tx, user, r.id, {
      action: "offer.accepted",
      entity: { type: "offer", id: offer.id },
      before: { status: offer.status, request: r.status },
      after: { status: offerTo, request: requestTo },
      meta: { declined: others.map((o) => o.id) },
    });

    const title = requestTitle(r);
    await notify(tx, {
      userId: offer.executor.userId,
      kind: "offer.chosen",
      title: n.offerChosen.title,
      body: n.offerChosen.body(title),
      link: links.executor(r.id),
    });
    for (const o of others) {
      await notify(tx, {
        userId: o.executor.userId,
        kind: "offer.declined",
        title: n.offerDeclined.title,
        body: n.offerDeclined.body(title),
        link: links.executor(r.id),
      });
    }
  });
}

// ─── чтение: заказчик ────────────────────────────────────────────────────────

/** Отклики на свою заявку (без отозванных) в выбранном порядке. Исполнитель — только «Исполнитель №N». */
export async function listOffers(user: CurrentUser, input: { requestId: string; sort: OfferSort }) {
  await loadOwnRequest(db, user, input.requestId);
  const offers = await db.offer.findMany({ where: { requestId: input.requestId, status: { not: "WITHDRAWN" } } });
  const views = await publicExecutorViews(offers.map((o) => o.executorId));
  const withExecutors = await Promise.all(
    offers.map(async (o) => {
      const executor = views.get(o.executorId) ?? (await publicExecutorView(o.executorId));
      const portfolio = await executorPortfolio(o.executorId, 4);
      return {
        id: o.id,
        status: o.status,
        price: o.price,
        durationDays: o.durationDays,
        warrantyMonths: o.warrantyMonths,
        measurementTerms: o.measurementTerms,
        measurementFee: o.measurementFee,
        comment: o.comment,
        createdAt: o.createdAt,
        executor,
        preview: portfolio.flatMap((i) => i.photos.slice(0, 1)),
      };
    }),
  );
  return sortOffers(withExecutors, input.sort);
}
export type OfferListItem = Awaited<ReturnType<typeof listOffers>>[number];

/** Карточка отклика одной страницей: условия, исполнитель, портфолио, отзывы, переписка. */
export async function getOfferForClient(user: CurrentUser, input: { requestId: string; offerId: string }) {
  const r = await loadOwnRequest(db, user, input.requestId);
  const o = await db.offer.findFirst({ where: { id: input.offerId, requestId: r.id, status: { not: "WITHDRAWN" } } });
  if (!o) return fail.notFound(e.offerNotFound);
  const [executor, portfolio, reviews] = await Promise.all([
    publicExecutorView(o.executorId),
    executorPortfolio(o.executorId, 8),
    executorReviews(o.executorId),
  ]);
  return {
    id: o.id,
    status: o.status,
    price: o.price,
    durationDays: o.durationDays,
    warrantyMonths: o.warrantyMonths,
    measurementTerms: o.measurementTerms,
    measurementFee: o.measurementFee,
    comment: o.comment,
    createdAt: o.createdAt,
    canChoose: r.status === "OPEN" && o.status === "SENT",
    request: { id: r.id, number: r.number, title: requestTitle(r), status: r.status },
    executor,
    portfolio,
    reviews,
  };
}
export type OfferDetail = Awaited<ReturnType<typeof getOfferForClient>>;

// ─── чтение: исполнитель ─────────────────────────────────────────────────────

/** Входящие: открытые заявки, видимые исполнителю (тендер его сегмента и прямые ему), с его откликом. */
export async function listIncomingRequests(user: CurrentUser, filter: { mode?: "TENDER" | "DIRECT" } = {}) {
  const executor = await loadExecutor(db, user);
  const rows = await db.request.findMany({
    where: { AND: [visibleToExecutor(executor), filter.mode ? { mode: filter.mode } : {}] },
    orderBy: { publishedAt: "desc" },
    include: {
      furnitureType: { select: { name: true } },
      offers: { where: { executorId: executor.id }, select: { status: true } },
      _count: { select: { offers: { where: { status: { not: "WITHDRAWN" } } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: requestTitle(r),
    mode: r.mode,
    segment: r.segment,
    style: r.style,
    city: r.city,
    desiredDate: r.desiredDate,
    publishedAt: r.publishedAt,
    offersCount: r._count.offers,
    myOfferStatus: r.offers[0]?.status ?? null,
  }));
}
export type IncomingListItem = Awaited<ReturnType<typeof listIncomingRequests>>[number];

/**
 * Заявка для исполнителя: видимая ему или та, где есть его отклик.
 * Адрес — только если выбран именно его отклик.
 */
export async function getIncomingRequest(user: CurrentUser, requestId: string) {
  const executor = await loadExecutor(db, user);
  const r = await db.request.findFirst({
    where: { id: requestId, OR: [visibleToExecutor(executor), { offers: { some: { executorId: executor.id } } }] },
    include: {
      furnitureType: { select: { name: true } },
      photos: { where: { purpose: "REQUEST_ROOM" }, orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } },
      offers: { where: { executorId: executor.id }, include: { measurement: true } },
    },
  });
  if (!r) return fail.notFound(e.notFound);
  const mine = r.offers[0] ?? null;
  const chosen = mine?.status === "ACCEPTED";
  return {
    id: r.id,
    number: r.number,
    title: requestTitle(r),
    status: r.status,
    mode: r.mode,
    segment: r.segment,
    style: r.style,
    details: parseDetails(r.details),
    city: r.city,
    address: chosen ? r.address : null,
    desiredDate: r.desiredDate,
    wishes: r.wishes,
    publishedAt: r.publishedAt,
    photos: await roomPhotos(r.photos),
    canOffer: r.status === "OPEN" && mine === null,
    defaults: { measurementTerms: executor.measurementTerms, measurementFee: executor.measurementFee },
    myOffer: mine && {
      id: mine.id,
      status: mine.status,
      price: mine.price,
      durationDays: mine.durationDays,
      warrantyMonths: mine.warrantyMonths,
      comment: mine.comment,
      measurementTerms: mine.measurementTerms,
      measurementFee: mine.measurementFee,
      measurement: mine.measurement && {
        id: mine.measurement.id,
        status: mine.measurement.status,
        scheduledAt: mine.measurement.scheduledAt,
        finalPrice: mine.measurement.finalPrice,
        feeAccrued: mine.measurement.feeAccrued,
        result: mine.measurement.result,
      },
    },
  };
}
export type IncomingRequest = Awaited<ReturnType<typeof getIncomingRequest>>;
