import type { Role } from "@/generated/prisma/enums";

/** Демо-персона, под которой показывать шаг: имя и телефон для входа на /demo. */
export type Persona = { userId: string; name: string; role: Role; phone: string };

type Ref = { id: string; number: number };
type WithParty<P extends "client" | "executor"> = Ref & Record<P, Persona>;

/**
 * Что сейчас есть в базе для каждого шага показа (docs/bank/05-demo-script.md): одна сделка на провайдере
 * manual — оферта, оплата по банковскому документу, работа, акт, выплата, итог.
 */
export type ScenarioSnapshot = {
  operator: Persona | null;
  newRequest?: { client: Persona };
  tender?: WithParty<"client">;
  /** Оферта на подписи. */
  signing?: WithParty<"client">;
  /** Оферта заключена, оплата ждёт банковского документа (HOLD в PENDING). */
  payment?: Ref;
  /** Деньги под защитой: мастер начинает и сдаёт работу. */
  work?: WithParty<"executor">;
  /** Работа сдана: покупатель подписывает акт. */
  act?: WithParty<"client">;
  /** Акт подписан: пакет на раскрытие и подтверждение выплаты. */
  payout?: Ref;
  completed?: WithParty<"client">;
};

export const SCENARIO_STEPS = ["request", "offers", "contract", "payment", "work", "act", "payout", "closing"] as const;
export type ScenarioStepKey = (typeof SCENARIO_STEPS)[number];

export type ScenarioStep = {
  key: ScenarioStepKey;
  /** Экран шага; null — в базе нет подходящей заявки или сделки. */
  href: string | null;
  persona: Persona | null;
  /** Номер заявки или сделки, которую показываем. */
  number?: number;
};

const party = (key: ScenarioStepKey, ref: WithParty<"client"> | WithParty<"executor"> | undefined, href: (r: Ref) => string): ScenarioStep => ({
  key,
  href: ref ? href(ref) : null,
  persona: ref ? ("client" in ref ? ref.client : ref.executor) : null,
  number: ref?.number,
});

const byOperator = (key: ScenarioStepKey, ref: Ref | undefined, operator: Persona | null): ScenarioStep => ({
  key,
  href: ref ? `/operator/deals/${ref.id}` : null,
  persona: ref ? operator : null,
  number: ref?.number,
});

const dealHref = (r: Ref) => `/deals/${r.id}`;

/** Сценарий: заявка → торг → оферта → оплата → работа → акт → выплата → итог. */
export function buildScenario(s: ScenarioSnapshot): ScenarioStep[] {
  const steps: Record<ScenarioStepKey, ScenarioStep> = {
    request: { key: "request", href: "/requests/new", persona: s.newRequest?.client ?? null },
    offers: party("offers", s.tender, (r) => `/requests/${r.id}`),
    contract: party("contract", s.signing, dealHref),
    payment: byOperator("payment", s.payment, s.operator),
    work: party("work", s.work, dealHref),
    act: party("act", s.act, dealHref),
    payout: byOperator("payout", s.payout, s.operator),
    closing: party("closing", s.completed, dealHref),
  };
  return SCENARIO_STEPS.map((key) => steps[key]);
}
