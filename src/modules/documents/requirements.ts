import type { DocumentKind, SignParty } from "@/generated/prisma/enums";

/**
 * Какие подписи нужны документу (ADR-009 раздел 6, решение владельца 2.2.4) — одно место.
 *  - оферта: обе стороны — собственноручно (HandSignature) и ЭЦП (Signature);
 *  - акт приёмки: покупатель — собственноручно и ЭЦП, мастер — ЭЦП; собственноручно — только при флаге
 *    executorHandSignsAct (OPEN_QUESTIONS №39);
 *  - выписка и расписка на раскрытие в приложении не подписываются.
 * «Полностью подписан» = есть все требуемые подписи.
 */
export type Requirement = { party: SignParty; hand: boolean; ecp: boolean };
export type SigningFlags = { executorHandSignsAct: boolean };
/** Чьи подписи уже есть: стороны с собственноручной подписью и стороны с ЭЦП. */
export type SignedParties = { hand: readonly SignParty[]; ecp: readonly SignParty[] };

export function requiredSignatures(kind: DocumentKind, flags: SigningFlags): Requirement[] {
  switch (kind) {
    case "CONTRACT":
      return [
        { party: "CLIENT", hand: true, ecp: true },
        { party: "EXECUTOR", hand: true, ecp: true },
      ];
    case "ACCEPTANCE_ACT":
      return [
        { party: "CLIENT", hand: true, ecp: true },
        { party: "EXECUTOR", hand: flags.executorHandSignsAct, ecp: true },
      ];
    case "MONEY_STATEMENT":
    case "RELEASE_RECEIPT":
      return [];
  }
}

export const isSignable = (kind: DocumentKind) => kind === "CONTRACT" || kind === "ACCEPTANCE_ACT";

/** Недостающие подписи стороны; null (оператор) — ничего. */
export function missingOf(kind: DocumentKind, flags: SigningFlags, party: SignParty | null, have: SignedParties): { hand: boolean; ecp: boolean } {
  const req = party ? requiredSignatures(kind, flags).find((r) => r.party === party) : undefined;
  if (!req || !party) return { hand: false, ecp: false };
  return { hand: req.hand && !have.hand.includes(party), ecp: req.ecp && !have.ecp.includes(party) };
}

export function isFullySigned(kind: DocumentKind, flags: SigningFlags, have: SignedParties): boolean {
  const req = requiredSignatures(kind, flags);
  if (req.length === 0) return false;
  return req.every((r) => {
    const missing = missingOf(kind, flags, r.party, have);
    return !missing.hand && !missing.ecp;
  });
}
