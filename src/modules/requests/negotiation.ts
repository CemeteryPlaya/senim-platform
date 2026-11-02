import "server-only";
import type { PriceProposal } from "@/generated/prisma/client";
import type { SignParty } from "@/generated/prisma/enums";
import { createDeal } from "@/modules/deal-core";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { kztToTiyn, partyEstimate } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, transaction, type Db, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { formatTiyn } from "@/ui/format";
import { auditByUser, links, loadExecutor, requestTitle } from "./access";
import { pathOf, TZ_PATH } from "./flows";
import type { ProposePriceInput } from "./schema";
import { OFFER_TRANSITIONS, PROPOSAL_TRANSITIONS, REQUEST_TRANSITIONS, stored, transition, type ProposalWho } from "./transitions";

/**
 * Торг по отклику (решение 2.2.3, ТЗ п. 9): до оферты покупатель заявки и мастер отклика обмениваются ценами раундами.
 * Первое предложение — цена отклика (sendOffer). Встречная цена заменяет открытое предложение другой стороны (SUPERSEDED),
 * своё можно отозвать, чужое — принять: принятая цена — X сделки, сделка с офертой создаётся в той же транзакции,
 * заявка закрывается для остальных откликов. Только на пути ТЗ (не в сценариях до договора).
 * Права: только покупатель заявки и мастер этого отклика; остальным — «не найдено» (IDOR).
 */

const e = ru.requests.errors;
const n = ru.requests.notify;

const withRequest = {
  request: { include: { furnitureType: { select: { name: true } } } },
  executor: { select: { userId: true } },
} as const;

async function loadOffer(tx: Db, offerId: string) {
  return tx.offer.findUnique({ where: { id: offerId }, include: withRequest });
}
type LoadedOffer = NonNullable<Awaited<ReturnType<typeof loadOffer>>>;

/** Сторона пользователя в отклике. Чужой отклик — NOT_FOUND. Мастер — только подтверждённый оператором (статус из БД). */
async function partyOf(tx: Db, user: CurrentUser, offer: LoadedOffer | null): Promise<{ offer: LoadedOffer; party: SignParty }> {
  if (offer && user.role === "CLIENT" && offer.request.clientId === user.id) return { offer, party: "CLIENT" };
  if (offer && user.role === "EXECUTOR" && user.executor?.id === offer.executorId) {
    await loadExecutor(tx, user);
    return { offer, party: "EXECUTOR" };
  }
  return fail.notFound(e.offerNotFound);
}

/** Торг идёт, пока отклик отправлен, заявка открыта и идёт путём ТЗ. */
function isLive(offer: LoadedOffer): boolean {
  return offer.status === "SENT" && offer.request.status === "OPEN" && pathOf(offer.request) === TZ_PATH;
}

function requireLive(offer: LoadedOffer): void {
  if (!isLive(offer)) fail.conflict(e.negotiationClosed);
}

const roleTo = (proposal: Pick<PriceProposal, "party">, party: SignParty): ProposalWho => (proposal.party === party ? "AUTHOR" : "OTHER");

/** Вторая сторона отклика: кому уведомление и куда ссылка. */
function otherSide(offer: LoadedOffer, party: SignParty) {
  return party === "CLIENT"
    ? { userId: offer.executor.userId, link: links.executor(offer.requestId) }
    : { userId: offer.request.clientId, link: links.offer(offer.requestId, offer.id) };
}

/** Первое предложение торга — цена отклика от мастера (в транзакции отправки отклика). */
export async function openNegotiation(tx: Tx, offer: { id: string; priceTiyn: bigint }, executorUserId: string): Promise<void> {
  await tx.priceProposal.create({ data: { offerId: offer.id, authorId: executorUserId, party: "EXECUTOR", amountTiyn: offer.priceTiyn } });
}

/**
 * Своя цена или встречная. Открытое предложение другой стороны становится SUPERSEDED, новое — PROPOSED.
 * Своё открытое предложение сначала отзывают. Две встречные одновременно — одна PROPOSED, вторая — CONFLICT.
 */
export async function proposePrice(user: CurrentUser, input: ProposePriceInput): Promise<{ proposalId: string }> {
  const amountTiyn = kztToTiyn(input.amountKzt);
  try {
    return await transaction(async (tx) => {
      const { offer, party } = await partyOf(tx, user, await loadOffer(tx, input.offerId));
      requireLive(offer);
      const open = await tx.priceProposal.findFirst({ where: { offerId: offer.id, status: "PROPOSED" } });
      if (open) {
        const to = stored(transition(PROPOSAL_TRANSITIONS, "counter", open.status, roleTo(open, party), undefined, e.waitAnswer));
        if (open.amountTiyn === amountTiyn) fail.validation(e.sameAmount);
        expectOneUpdated(
          await tx.priceProposal.updateMany({ where: { id: open.id, status: open.status }, data: { status: to, decidedAt: new Date(), decidedById: user.id } }),
        );
      } else {
        transition(PROPOSAL_TRANSITIONS, "propose", "NONE", "AUTHOR");
      }
      // Второе открытое предложение по отклику упирается в частичный уникальный индекс → CONFLICT ниже.
      const created = await tx.priceProposal.create({ data: { offerId: offer.id, authorId: user.id, party, amountTiyn } });
      await auditByUser(tx, user, offer.requestId, {
        action: open ? "price.countered" : "price.proposed",
        entity: { type: "priceProposal", id: created.id },
        before: open ? { proposalId: open.id, amountTiyn: String(open.amountTiyn), status: open.status } : undefined,
        after: { status: created.status, party, amountTiyn: String(amountTiyn) },
        meta: { offerId: offer.id },
      });
      await notify(tx, {
        ...otherSide(offer, party),
        kind: "price.proposed",
        title: n.priceProposed.title,
        body: n.priceProposed.body(requestTitle(offer.request), formatTiyn(amountTiyn)),
      });
      return { proposalId: created.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict();
    throw err;
  }
}

async function loadProposal(tx: Db, user: CurrentUser, proposalId: string) {
  const proposal = await tx.priceProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return fail.notFound(e.proposalNotFound);
  const { offer, party } = await partyOf(tx, user, await loadOffer(tx, proposal.offerId));
  return { proposal, offer, party };
}

/** Автор отзывает своё открытое предложение: PROPOSED → WITHDRAWN. Чужое отозвать нельзя. */
export async function withdrawPrice(user: CurrentUser, input: { proposalId: string }): Promise<void> {
  await transaction(async (tx) => {
    const { proposal, offer, party } = await loadProposal(tx, user, input.proposalId);
    requireLive(offer);
    const to = stored(transition(PROPOSAL_TRANSITIONS, "withdraw", proposal.status, roleTo(proposal, party), undefined, e.notYourProposal));
    expectOneUpdated(
      await tx.priceProposal.updateMany({ where: { id: proposal.id, status: proposal.status }, data: { status: to, decidedAt: new Date(), decidedById: user.id } }),
    );
    await auditByUser(tx, user, offer.requestId, {
      action: "price.withdrawn",
      entity: { type: "priceProposal", id: proposal.id },
      before: { status: proposal.status },
      after: { status: to },
      meta: { offerId: offer.id },
    });
    await notify(tx, {
      ...otherSide(offer, party),
      kind: "price.withdrawn",
      title: n.priceWithdrawn.title,
      body: n.priceWithdrawn.body(requestTitle(offer.request), formatTiyn(proposal.amountTiyn)),
    });
  });
}

/**
 * Принять цену другой стороны: предложение ACCEPTED, отклик ACCEPTED, остальные отправленные отклики DECLINED,
 * заявка OPEN → CONTRACTING и сделка с офертой (deal-core.createDeal) — всё в одной транзакции.
 * Двойной клик и одновременный акцепт по двум откликам — одна сделка (условные обновления).
 */
export async function acceptPrice(user: CurrentUser, input: { proposalId: string }): Promise<{ dealId: string }> {
  return transaction(async (tx) => {
    const { proposal, offer, party } = await loadProposal(tx, user, input.proposalId);
    requireLive(offer);
    const r = offer.request;
    const to = stored(transition(PROPOSAL_TRANSITIONS, "accept", proposal.status, roleTo(proposal, party), undefined, e.ownProposal));
    const requestTo = transition(REQUEST_TRANSITIONS, "priceAccepted", r.status, party, pathOf(r));
    const offerTo = transition(OFFER_TRANSITIONS, "priceAccepted", offer.status, party);

    expectOneUpdated(
      await tx.priceProposal.updateMany({ where: { id: proposal.id, status: proposal.status }, data: { status: to, decidedAt: new Date(), decidedById: user.id } }),
    );
    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: requestTo } }));
    expectOneUpdated(await tx.offer.updateMany({ where: { id: offer.id, status: offer.status }, data: { status: offerTo } }));
    const others = await tx.offer.findMany({
      where: { requestId: r.id, status: "SENT", id: { not: offer.id } },
      select: { id: true, executor: { select: { userId: true } } },
    });
    const declined = transition(OFFER_TRANSITIONS, "closedForOthers", "SENT", "SYSTEM");
    await tx.offer.updateMany({ where: { id: { in: others.map((o) => o.id) }, status: "SENT" }, data: { status: declined } });

    const title = requestTitle(r);
    // Оферта — от имени принявшего; deal-core уведомляет обе стороны «Оферта готова».
    const { dealId } = await createDeal(tx, { requestId: r.id, offerId: offer.id, priceTiyn: proposal.amountTiyn, title, actor: actorOf(user) });
    await auditByUser(tx, user, r.id, {
      action: "price.accepted",
      entity: { type: "priceProposal", id: proposal.id },
      before: { status: proposal.status, request: r.status, offer: offer.status },
      after: { status: to, request: requestTo, offer: offerTo, amountTiyn: String(proposal.amountTiyn), dealId },
      meta: { offerId: offer.id, declined: others.map((o) => o.id) },
    });
    for (const o of others) {
      await notify(tx, { userId: o.executor.userId, kind: "offer.declined", title: n.offerDeclined.title, body: n.offerDeclined.body(title), link: links.executor(r.id) });
    }
    return { dealId };
  });
}

// ─── чтение ──────────────────────────────────────────────────────────────────

/**
 * Торг глазами стороны отклика: раунды по порядку, открытое предложение, что можно сделать, и смета до оплаты
 * по текущей цене (покупателю — с защитой сделки 2 %, мастеру — с гарантией 4 %, ТЗ п. 5).
 */
export async function getNegotiation(user: CurrentUser, input: { offerId: string }) {
  const { offer, party } = await partyOf(db, user, await loadOffer(db, input.offerId));
  const rows = await db.priceProposal.findMany({ where: { offerId: offer.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const live = isLive(offer);
  const open = rows.find((p) => p.status === "PROPOSED") ?? null;
  const accepted = rows.find((p) => p.status === "ACCEPTED") ?? null;
  const priceTiyn = accepted?.amountTiyn ?? open?.amountTiyn ?? rows.at(-1)?.amountTiyn ?? offer.priceTiyn;
  const deal = accepted ? await db.deal.findUnique({ where: { offerId: offer.id }, select: { id: true } }) : null;
  const theirs = open !== null && open.party !== party;
  return {
    offerId: offer.id,
    party,
    live,
    rounds: rows.map((p) => ({ id: p.id, party: p.party, mine: p.party === party, amountTiyn: p.amountTiyn, status: p.status, createdAt: p.createdAt, decidedAt: p.decidedAt })),
    open: open && { id: open.id, party: open.party, mine: !theirs, amountTiyn: open.amountTiyn },
    can: { propose: live && !(open && !theirs), accept: live && theirs, withdraw: live && open !== null && !theirs },
    priceTiyn,
    estimate: partyEstimate(party, priceTiyn),
    dealId: deal?.id ?? null,
  };
}
export type NegotiationView = Awaited<ReturnType<typeof getNegotiation>>;
