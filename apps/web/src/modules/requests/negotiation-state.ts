import type { ProposalStatus, SignParty } from "@/generated/prisma/enums";

/**
 * Состояние торга для экрана — чистая функция над раундами (решение 2.2.3): открытое предложение, чьё оно,
 * что может сделать сторона и какая цена сейчас. Правила переходов — PROPOSAL_TRANSITIONS; здесь только чтение.
 */

export type Round = { id: string; party: SignParty; amountTiyn: bigint; status: ProposalStatus };

export type NegotiationState = {
  open: { id: string; party: SignParty; mine: boolean; amountTiyn: bigint } | null;
  accepted: boolean;
  can: { propose: boolean; accept: boolean; withdraw: boolean };
  /** Текущая цена: принятая, открытая, последняя названная или цена отклика. */
  priceTiyn: bigint;
};

/** Своё открытое предложение сначала отзывают; чужое — принимают или перебивают встречной ценой. */
function allowed(live: boolean, open: Round | null, mine: boolean): NegotiationState["can"] {
  if (!live) return { propose: false, accept: false, withdraw: false };
  return { propose: !mine, accept: open !== null && !mine, withdraw: mine };
}

export function negotiationState(rounds: readonly Round[], party: SignParty, live: boolean, offerPriceTiyn: bigint): NegotiationState {
  const open = rounds.find((p) => p.status === "PROPOSED") ?? null;
  const accepted = rounds.find((p) => p.status === "ACCEPTED") ?? null;
  const mine = open?.party === party;
  const current = accepted ?? open ?? rounds.at(-1);
  return {
    open: open && { id: open.id, party: open.party, mine, amountTiyn: open.amountTiyn },
    accepted: accepted !== null,
    can: allowed(live, open, mine),
    priceTiyn: current ? current.amountTiyn : offerPriceTiyn,
  };
}
