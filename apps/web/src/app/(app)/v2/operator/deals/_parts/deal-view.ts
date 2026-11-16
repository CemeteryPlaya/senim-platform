import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { TimelineItem } from "@/kit";
import type { DealDocument, JournalRow } from "@/modules/operator";
import type { MoneyBlock } from "@/modules/payments";

const t = ru.app.operatorDeals;

/** Блок денег сделки по журналу (не по статусу сделки): тон панели, подпись, главная сумма и строки. Суммы — тиыны. */
export type DealMoney = {
  tone: "awaiting" | "protected" | "frozen" | "completed" | "refunded";
  title: string;
  amount: bigint;
  rows: { label: string; amount: bigint }[];
  note?: string;
};

/**
 * Панель денег карточки сделки оператора. Главная сумма — то, что называет блок (остаток под защитой, выплата мастеру,
 * возврат); внизу всегда остаток на счёте сделки по журналу. Пометка тестовых денег — только оператору (эта страница).
 */
export function dealMoney(money: MoneyBlock): DealMoney {
  const m = t.money;
  const rows = [{ label: m.bankBalance, amount: money.bankBalanceTiyn }];
  const note = money.isTest ? m.test : undefined;
  const base = (() => {
    switch (money.kind) {
      case "awaiting":
        return { tone: "awaiting" as const, title: m.awaiting, amount: 0n };
      case "protected":
        return { tone: "protected" as const, title: m.protected, amount: money.amountTiyn };
      case "frozen":
        return { tone: "frozen" as const, title: m.frozen, amount: money.amountTiyn };
      case "completed":
        return { tone: "completed" as const, title: money.settled ? m.completed : m.completedPending, amount: money.paidToMasterTiyn };
      case "refunded":
        return { tone: "refunded" as const, title: money.settled ? m.refunded : m.refundedPending, amount: money.amountTiyn };
    }
  })();
  return { ...base, rows, ...(note ? { note } : {}) };
}

/**
 * Журнал денег лентой (источник правды о деньгах): номер, тип и статус операции, сумма справа; в тексте — время итога,
 * документ банка, причина отказа, ключ идемпотентности и пометка «тестовая» (только оператору).
 */
export function journalTimeline(rows: readonly JournalRow[]): TimelineItem[] {
  const c = t.card;
  return rows.map((r) => {
    const lines = [
      ...(r.settledAt ? [formatDateTime(r.settledAt)] : []),
      ...(r.bankDocNumber && r.bankDocDate ? [c.bankDoc(r.bankDocNumber, formatDate(r.bankDocDate))] : []),
      ...(r.error ? [c.error(r.error)] : []),
      c.key(r.idempotencyKey),
      ...(r.isTest ? [t.testMark] : []),
    ];
    return {
      title: c.journalItem(r.seq, t.moneyTypes[r.type], t.moneyStatus[r.status]),
      time: formatDateTime(r.createdAt),
      text: lines.join(" · "),
      amount: r.amountTiyn,
    };
  });
}

/** Одна подпись документа строкой: кто, как и когда; хэш подписанного — совпадает ли с хэшем документа. */
export type SignatureLine = { key: string; text: string; detail: string[]; mismatch: boolean };

/** Подписи документа: ЭЦП (проверена ли, тот ли хэш, субъект сертификата) и собственноручные (хэш, время, IP). */
export function signatureLines(doc: DealDocument): SignatureLine[] {
  const d = t.documents;
  const ecp = doc.signatures.map((s): SignatureLine => {
    const same = s.signedSha256 === doc.sha256;
    return {
      key: `ecp-${s.party}-${s.signedAt.toISOString()}`,
      text: d.signature(d.parties[s.party], d.methods[s.method], formatDateTime(s.signedAt)),
      detail: [s.certSubject, same ? d.hashMatches : d.hashDiffers, s.verified ? d.verified : d.notVerified],
      mismatch: !same || !s.verified,
    };
  });
  const hand = doc.handSignatures.map((h): SignatureLine => {
    const same = h.documentSha256 === doc.sha256;
    return {
      key: `hand-${h.party}-${h.signedAt.toISOString()}`,
      text: d.signature(d.parties[h.party], h.typedName ? d.typed(h.typedName) : d.hand, formatDateTime(h.signedAt)),
      detail: [same ? d.hashMatches : d.hashDiffers, ...(h.ip ? [d.ip(h.ip)] : [])],
      mismatch: !same,
    };
  });
  return [...ecp, ...hand];
}
