import { formatDate, formatDays, formatMonths } from "@/features/format/format";
import type { SignMethodChoice, SignStep } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import type { SigningDocumentView } from "@/modules/documents/client";
import type { Device } from "@/platform/device";
import type { DealSide } from "../../../../../../_shell/side";

const t = ru.app.deal.sign;
const tm = ru.app.masterSteps.sign;

/** Документы, которые подписывают стороны на этом экране. */
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
  /** Сторона документа (`doc.myParty`): суммы и подписи строк — свои у каждой стороны. */
  side: DealSide;
  kind: SignKind;
  number: string;
  executorLabel: string;
  buyerName: string | null;
  /**
   * Смета стороны модуля (`deal.estimate`, `partyEstimate` по стороне): покупателю — цена и к оплате (без доплат),
   * мастеру — цена, гарантия оплаты и клиента и «Вы получите». Ничего не считается на экране.
   */
  estimate: { priceTiyn: bigint; extraTiyn: bigint; totalTiyn: bigint };
  durationDays: number;
  warrantyMonths: number;
  readyAt: Date | null;
};

/**
 * «Что вы подписываете»: документ, стороны, цена; для оферты — суммы стороны, срок и гарантия; для акта — когда сдана
 * работа. Покупатель: мастер — подпись модуля («Исполнитель №N» или имя по режиму ADR-006); в оферте цена и сумма к оплате —
 * одна сумма (без доплат, ADR-015), одной строкой «Цена по оферте, без доплат».
 * Мастер: «Мастер — Вы», без строки покупателя (имени модуль мастеру не отдаёт), гарантия оплаты и клиента и «Вы получите»;
 * сумм покупателя (защита сделки, к оплате) у мастера нет.
 */
export function whatRows(i: WhatInput): WhatRow[] {
  return i.side === "EXECUTOR" ? masterRows(i) : buyerRows(i);
}

function buyerRows(i: WhatInput): WhatRow[] {
  const w = t.what;
  const rows: WhatRow[] = [
    { label: w.document, value: t.documentName(t.kinds[i.kind], i.number) },
    { label: w.master, value: i.executorLabel },
    { label: w.buyer, value: i.buyerName ?? w.you },
  ];
  if (i.kind === "CONTRACT") {
    rows.push(
      { label: w.priceTotal, amount: i.estimate.totalTiyn, total: true },
      { label: w.duration, value: formatDays(i.durationDays) },
      { label: w.warranty, value: formatMonths(i.warrantyMonths) },
    );
  } else {
    rows.push({ label: w.price, amount: i.estimate.priceTiyn });
    if (i.readyAt) rows.push({ label: w.readyAt, value: formatDate(i.readyAt) });
  }
  return rows;
}

function masterRows(i: WhatInput): WhatRow[] {
  const w = t.what;
  const m = tm.what;
  const rows: WhatRow[] = [
    { label: w.document, value: t.documentName(t.kinds[i.kind], i.number) },
    { label: w.master, value: m.you },
    { label: w.price, amount: i.estimate.priceTiyn },
    { label: m.guarantee, amount: i.estimate.extraTiyn },
    { label: m.youGet, amount: i.estimate.totalTiyn, total: true },
  ];
  if (i.kind === "CONTRACT") {
    rows.push({ label: w.duration, value: formatDays(i.durationDays) }, { label: m.warranty, value: formatMonths(i.warrantyMonths) });
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
export function farWarning(kind: SignKind, ready: ReadyGps | null, side: DealSide = "CLIENT"): string | null {
  if (kind !== "ACCEPTANCE_ACT" || !ready || ready.withinRadius !== false || ready.distanceM === null) return null;
  return (side === "EXECUTOR" ? tm.act.far : t.act.far)(String(ready.distanceM), String(ready.radiusM));
}

/** Заголовок экрана по стороне: покупателю акт — «Примите мебель: подпишите акт», мастеру — «Подпишите акт приёмки». */
export const signTitle = (kind: SignKind, side: DealSide): string => (side === "EXECUTOR" ? tm.title[kind] : t.title[kind]);

/** Ключ ЭЦП (NCALayer) — программа на компьютере: на телефоне его не предлагаем. */
export const methodsFor = (device: Device): readonly SignMethodChoice[] => (device === "desktop" ? ["EGOV_QR", "NCALAYER"] : ["EGOV_QR"]);
