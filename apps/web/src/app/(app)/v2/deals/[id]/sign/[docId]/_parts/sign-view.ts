import { formatDate, formatDays, formatMonths } from "@/features/format/format";
import type { SignStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import type { SigningDocumentView } from "@/modules/documents/client";

const t = ru.app.deal.sign;

/** Документы, которые подписывает покупатель на этом экране. */
export type SignKind = "CONTRACT" | "ACCEPTANCE_ACT";

export const isSignKind = (kind: string): kind is SignKind => kind === "CONTRACT" || kind === "ACCEPTANCE_ACT";

/** Шаг подписи на экране: от руки или ЭЦП — номер шага и всего шагов покупателя (по требованиям модуля к документу). */
export type StepView = { kind: "hand" | "ecp"; step: number; total: number; ecpAfterHand: boolean };

/**
 * Что показать: шаг подписи (`signStep` из features — те же правила, что в v1: сначала от руки, затем ЭЦП) или `null` —
 * подписывать сейчас нечего (всё своё подписано, шаг сделки не тот, версия закрыта): экран уводит на карточку сделки.
 * Номер шага — по подписям, которые модуль требует от этой стороны (`parties[].required`).
 */
export function stepView(doc: Pick<SigningDocumentView, "status" | "signable" | "myParty" | "canSign" | "parties">, step: SignStep): StepView | null {
  if (step !== "hand" && step !== "ecp") return null;
  const mine = doc.parties.find((p) => p.party === doc.myParty);
  const handRequired = mine?.required.hand ?? false;
  const ecpRequired = mine?.required.ecp ?? false;
  const total = Number(handRequired) + Number(ecpRequired);
  if (step === "hand") return { kind: "hand", step: 1, total: Math.max(total, 1), ecpAfterHand: doc.canSign.ecp };
  return { kind: "ecp", step: handRequired ? 2 : 1, total: Math.max(total, 1), ecpAfterHand: false };
}

/** Строка «подпись — значение» карточки «Что вы подписываете»; сумма — тиыны (показ через `Money`). */
export type WhatRow = { label: string; value: string } | { label: string; amount: bigint; total?: boolean };

export type WhatInput = {
  kind: SignKind;
  number: string;
  executorLabel: string;
  buyerName: string | null;
  /** Смета покупателя модуля (`deal.estimate`, `partyEstimate`): ничего не считается на экране. */
  estimate: { priceTiyn: bigint; totalTiyn: bigint };
  durationDays: number;
  warrantyMonths: number;
  readyAt: Date | null;
};

/**
 * «Что вы подписываете»: документ, стороны (мастер — подпись модуля: «Исполнитель №N» или имя по режиму ADR-006), цена;
 * для оферты — к оплате с защитой сделки, срок и гарантия; для акта — когда сдана работа.
 */
export function whatRows(i: WhatInput): WhatRow[] {
  const w = t.what;
  const rows: WhatRow[] = [
    { label: w.document, value: t.documentName(t.kinds[i.kind], i.number) },
    { label: w.master, value: i.executorLabel },
    { label: w.buyer, value: i.buyerName ?? w.you },
    { label: w.price, amount: i.estimate.priceTiyn },
  ];
  if (i.kind === "CONTRACT") {
    rows.push(
      { label: w.total, amount: i.estimate.totalTiyn, total: true },
      { label: w.duration, value: formatDays(i.durationDays) },
      { label: w.warranty, value: formatMonths(i.warrantyMonths) },
    );
  } else if (i.readyAt) {
    rows.push({ label: w.readyAt, value: formatDate(i.readyAt) });
  }
  return rows;
}

/** Мягкая проверка GPS модуля (`deal.ready`): мастер отметил сдачу дальше радиуса от адреса. */
export type ReadyGps = { distanceM: number | null; withinRadius: boolean | null; radiusM: number };

/**
 * Предупреждение о расстоянии для акта: только если модуль отдал расстояние и оно вне радиуса (как строка «Сдано в N м
 * от адреса заказа — дальше M м» раздела «Сдача» в v1). Без координат или в радиусе — ничего: приёмку это не меняет.
 */
export function farWarning(kind: SignKind, ready: ReadyGps | null): string | null {
  if (kind !== "ACCEPTANCE_ACT" || !ready || ready.withinRadius !== false || ready.distanceM === null) return null;
  return t.act.far(String(ready.distanceM), String(ready.radiusM));
}
