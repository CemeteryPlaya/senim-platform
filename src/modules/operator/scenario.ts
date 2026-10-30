import type { RailMode } from "@/modules/payments";

/** Демо-персона, под которой показывать шаг: имя и телефон для входа на /demo. */
export type Persona = { userId: string; name: string; role: "CLIENT" | "EXECUTOR" | "OPERATOR"; phone: string };

type Ref<P extends "client" | "executor"> = { id: string; number: number } & Record<P, Persona>;

/** Что сейчас есть в базе для каждого шага полного цикла (берётся из demo-данных). */
export type ScenarioSnapshot = {
  railMode: RailMode;
  newRequest?: { client: Persona };
  tender?: Ref<"client"> & { offers: number };
  measuring?: Ref<"executor">;
  signing?: Ref<"client">;
  deposit?: Ref<"client">;
  inProgress?: Ref<"executor">;
  completed?: Ref<"client">;
};

export const SCENARIO_STEPS = ["request", "offers", "measurement", "contract", "deposit", "stages", "closing"] as const;
export type ScenarioStepKey = (typeof SCENARIO_STEPS)[number];

export type ScenarioStep = {
  key: ScenarioStepKey;
  /** Экран шага; null — в базе нет подходящей заявки или сделки. */
  href: string | null;
  /** Второй экран шага (симулятор банка для пополнения). */
  extraHref?: string;
  persona: Persona | null;
  /** Номер заявки или сделки, которую показываем. */
  number?: number;
  /** Шаг существует только в эскроу-режиме, а эскроу-сделки ещё нет. */
  needsEscrow?: boolean;
};

const deal = (ref: { id: string } | undefined) => (ref ? `/deals/${ref.id}` : null);

/** Сценарий: заявка → отклики → замер → договор → пополнение эскроу → этапы с траншами → закрытие. */
export function buildScenario(s: ScenarioSnapshot): ScenarioStep[] {
  const steps: Record<ScenarioStepKey, ScenarioStep> = {
    request: { key: "request", href: "/requests/new", persona: s.newRequest?.client ?? null },
    offers: { key: "offers", href: s.tender ? `/requests/${s.tender.id}` : null, persona: s.tender?.client ?? null, number: s.tender?.number },
    measurement: { key: "measurement", href: s.measuring ? "/executor/measurements" : null, persona: s.measuring?.executor ?? null, number: s.measuring?.number },
    contract: { key: "contract", href: deal(s.signing), persona: s.signing?.client ?? null, number: s.signing?.number },
    deposit: {
      key: "deposit",
      href: deal(s.deposit),
      extraHref: s.deposit ? "/simulator" : undefined,
      persona: s.deposit?.client ?? null,
      number: s.deposit?.number,
      needsEscrow: !s.deposit,
    },
    stages: { key: "stages", href: deal(s.inProgress), persona: s.inProgress?.executor ?? null, number: s.inProgress?.number },
    closing: { key: "closing", href: deal(s.completed), persona: s.completed?.client ?? null, number: s.completed?.number },
  };
  return SCENARIO_STEPS.map((key) => steps[key]);
}
