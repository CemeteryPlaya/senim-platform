import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatPhone, type MyData, type RevocationView } from "@/modules/identity";
import { to } from "../../../_shell/paths";

const t = ru.app.profile.data;

export type DataRow = { label: string; value: string; stacked: boolean };

/** Сделка, к которой дано согласие на передачу данных банку: подпись, ссылка и дата — если даты в карточке разные. */
export type ConsentDealView = { label: string; href: string; granted: string | null };

/**
 * Карточка согласия. Одинаковые согласия (вид и редакция) — одной карточкой со строками сделок: карточки отличались бы
 * только сделкой. Дата — у карточки, если она одна на всех; иначе — у строки каждой сделки (`granted` = null).
 */
export type ConsentView = {
  id: string;
  title: string;
  edition: string;
  granted: string | null;
  deals: ConsentDealView[];
};

export type RevocationBlock = {
  status: RevocationView["status"];
  statusText: string;
  rows: { label: string; value: string }[];
  open: boolean;
};

export type DataView = {
  person: DataRow[];
  consents: ConsentView[];
  revocation: RevocationBlock | null;
  /** Можно отозвать: действует согласие на обработку данных и нет открытой заявки. */
  canRevoke: boolean;
  /** Номера сделок с согласием на передачу данных банку («№3, №5»): отзыв их не касается. */
  bankDeals: string | null;
};

/** ИИН — только последние четыре символа; нет ИИН — «Не указано». Полного ИИН в данных экрана нет вовсе. */
export function maskedIin(last4: string | null): string {
  return last4 ? t.iinMasked(last4.slice(-4)) : t.notSet;
}

function revocationBlock(rev: RevocationView): RevocationBlock {
  const rows = [
    { label: t.revocation.requestedAt, value: formatDateTime(rev.requestedAt) },
    ...(rev.status === "REQUESTED" ? [{ label: t.revocation.dueAt, value: formatDate(rev.dueAt) }] : []),
    ...(rev.decidedAt ? [{ label: t.revocation.decidedAt, value: formatDateTime(rev.decidedAt) }] : []),
    ...(rev.reason ? [{ label: t.revocation.reason, value: rev.reason }] : []),
  ];
  return { status: rev.status, statusText: t.revocation.status[rev.status], rows, open: rev.status === "REQUESTED" };
}

/** Сделка согласия: номер и название заказа (по одному номеру сделку не узнать). */
export type ConsentDeal = { number: number; title: string };

/** Согласия одного вида и одной редакции — одной карточкой (порядок — по первому в группе, как отдал модуль). */
function consentGroups(consents: MyData["consents"], deals: ReadonlyMap<string, ConsentDeal>): ConsentView[] {
  const groups = new Map<string, MyData["consents"]>();
  for (const c of consents) {
    const key = `${c.kind}\u0000${c.version}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].flatMap((group) => {
    const [first] = group;
    if (!first) return [];
    const dates = group.map((c) => formatDateTime(c.grantedAt));
    const shared = dates.every((d) => d === dates[0]);
    return [
      {
        id: first.id,
        title: t.consentKinds[first.kind],
        edition: ru.app.onboarding.consent.edition(first.version),
        granted: shared ? (dates[0] ?? null) : null,
        deals: group.flatMap((c, i) => {
          if (!c.dealId) return [];
          const deal = deals.get(c.dealId);
          return [{ label: deal === undefined ? t.dealUnknown : t.deal(deal.number, deal.title), href: to(`/deals/${c.dealId}`), granted: shared ? null : (dates[i] ?? null) }];
        }),
      },
    ];
  });
}

/** Модель экрана «Мои данные»: личные данные, согласия с редакцией и датой, заявка на отзыв. `deals` — сделки по id. */
export function dataView(data: MyData, deals: ReadonlyMap<string, ConsentDeal>): DataView {
  const notSet = t.notSet;
  const consents = consentGroups(data.consents, deals);
  const open = data.revocation?.status === "REQUESTED";
  const bankNumbers = data.consents.flatMap((c) => {
    const number = c.dealId ? deals.get(c.dealId)?.number : undefined;
    return number === undefined ? [] : [number];
  });
  return {
    person: [
      { label: t.rows.fullName, value: data.fullName ?? notSet, stacked: true },
      { label: t.rows.iin, value: maskedIin(data.iinLast4), stacked: false },
      { label: t.rows.phone, value: formatPhone(data.phone), stacked: false },
      { label: t.rows.email, value: data.email ?? notSet, stacked: true },
      { label: t.rows.instagram, value: data.instagram ?? notSet, stacked: false },
    ],
    consents,
    revocation: data.revocation ? revocationBlock(data.revocation) : null,
    canRevoke: !open && data.consents.some((c) => c.kind === "PD_PROCESSING"),
    bankDeals: bankNumbers.length > 0 ? bankNumbers.map((n) => `№${n}`).join(", ") : null,
  };
}
