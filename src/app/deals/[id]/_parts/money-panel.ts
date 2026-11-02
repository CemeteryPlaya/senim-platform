import type { MoneyBlock } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { formatDate, formatTiyn } from "@/ui/format";

/**
 * Блок денег — первый блок карточки сделки (ТЗ п. 4.1, 4.2; решение 2.1.5). Строится только из журнала
 * (moneyBlock), не из статуса сделки. Чистая функция: тон, значок и готовые строки; разметка — MoneyBlockView.
 * Цвет не единственный носитель смысла: у каждого тона свой значок и заголовок словами.
 */

export type MoneyTone = "neutral" | "success" | "warning";
export type MoneyIcon = "clock" | "alert" | "lock" | "pause" | "check" | "undo";
export type MoneyPanel = { tone: MoneyTone; icon: MoneyIcon; title: string; lines: string[]; testNote: string | null };
type Party = "CLIENT" | "EXECUTOR";

const b = ru.payments.block;

function awaiting(payment: "none" | "PENDING" | "FAILED", party: Party): Omit<MoneyPanel, "testNote"> {
  if (payment === "PENDING") return { tone: "neutral", icon: "clock", title: b.pending.title, lines: [b.pending.text] };
  if (payment === "FAILED") return { tone: "warning", icon: "alert", title: b.failed.title, lines: [b.failed[party]] };
  return { tone: "neutral", icon: "clock", title: b.awaiting.title, lines: [b.awaiting[party]] };
}

type Completed = Extract<MoneyBlock, { kind: "completed" }>;

function completed(m: Completed, party: Party): Omit<MoneyPanel, "testNote"> {
  const paid = (m.settled ? b.completed.paid : b.completed.toPay)[party](formatTiyn(m.paidToMasterTiyn));
  const lines = [paid, ...(party === "CLIENT" ? [b.completed.protection(formatTiyn(m.protectionTiyn))] : [])];
  if (m.refundedTiyn > 0n) lines.push(b.completed.refunded(formatTiyn(m.refundedTiyn)));
  return m.settled ? { tone: "success", icon: "check", title: b.completed.title, lines } : { tone: "success", icon: "clock", title: b.completed.pending, lines };
}

function panelOf(m: MoneyBlock, party: Party, payoutTiyn: bigint): Omit<MoneyPanel, "testNote"> {
  switch (m.kind) {
    case "awaiting":
      return awaiting(m.payment, party);
    case "protected": {
      // Мастеру — то, что он получит (выплата по оферте), а не сумма, внесённая покупателем.
      const amount = formatTiyn(party === "EXECUTOR" ? payoutTiyn : m.amountTiyn);
      const lines = [b.reservedAt(formatDate(m.reservedAt)), ...(m.operationRef ? [b.operationRef(m.operationRef)] : [])];
      return { tone: "success", icon: "lock", title: b.protected[party](amount), lines };
    }
    case "frozen":
      return { tone: "warning", icon: "pause", title: b.frozen.title, lines: [b.frozen.text(formatTiyn(m.amountTiyn))] };
    case "completed":
      return completed(m, party);
    case "refunded":
      return m.settled
        ? { tone: "neutral", icon: "undo", title: b.refunded.title(formatTiyn(m.amountTiyn)), lines: [] }
        : { tone: "neutral", icon: "clock", title: b.refunded.pending[party], lines: [b.refunded.amount(formatTiyn(m.amountTiyn))] };
  }
}

/** Оператор смотрит глазами покупателя: его формулировки — полные. */
export function moneyPanel(m: MoneyBlock, party: Party, payoutTiyn: bigint): MoneyPanel {
  return { ...panelOf(m, party, payoutTiyn), testNote: m.isTest ? b.testPayment : null };
}
