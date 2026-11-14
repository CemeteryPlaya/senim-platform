import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatPhone, type MyData, type RevocationView } from "@/modules/identity";
import { to } from "../../../_shell/paths";

const t = ru.app.profile.data;

export type DataRow = { label: string; value: string; stacked: boolean };

export type ConsentView = {
  id: string;
  title: string;
  edition: string;
  granted: string;
  /** Сделка, к которой дано согласие на передачу данных банку: подпись и ссылка. */
  deal: { label: string; href: string } | null;
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

/** Модель экрана «Мои данные»: личные данные, согласия с редакцией и датой, заявка на отзыв. `numbers` — номера сделок по id. */
export function dataView(data: MyData, numbers: ReadonlyMap<string, number>): DataView {
  const notSet = t.notSet;
  const consents: ConsentView[] = data.consents.map((c) => {
    const number = c.dealId ? numbers.get(c.dealId) : undefined;
    return {
      id: c.id,
      title: t.consentKinds[c.kind],
      edition: ru.app.onboarding.consent.edition(c.version),
      granted: formatDateTime(c.grantedAt),
      deal: c.dealId ? { label: number === undefined ? t.dealUnknown : t.deal(number), href: to(`/deals/${c.dealId}`) } : null,
    };
  });
  const open = data.revocation?.status === "REQUESTED";
  const bankNumbers = data.consents.flatMap((c) => {
    const number = c.dealId ? numbers.get(c.dealId) : undefined;
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
