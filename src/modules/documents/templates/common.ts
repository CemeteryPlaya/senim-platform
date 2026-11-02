import { formatDate, formatDateTime, formatTiyn } from "@/ui/format";

/**
 * Редакция шаблонов. Тексты оферты, акта, выписки и расписки — проект: до работы с реальными
 * деньгами их проверяет юрист; после проверки поднять редакцию и убрать пометку.
 */
export const TEMPLATE_EDITION = "ред. 2026-11, ТЗ MVP v1.0";
export const LEGAL_REVIEW_NOTICE = "Шаблон требует юридической проверки";

export const money = formatTiyn;
export const date = formatDate;
export const dateTime = formatDateTime;

/** 1 месяц, 2 месяца, 5 месяцев. */
export function months(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} месяц`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} месяца`;
  return `${n} месяцев`;
}

const pad = (n: number) => String(n).padStart(4, "0");

/** Номера документов сделки: оферта «Д-0014/2026», акт «А-0014», выписка «В-0014», расписка «Р-0014». */
export const documentNumber = {
  CONTRACT: (dealNumber: number, year: number) => `Д-${pad(dealNumber)}/${year}`,
  ACCEPTANCE_ACT: (dealNumber: number) => `А-${pad(dealNumber)}`,
  MONEY_STATEMENT: (dealNumber: number) => `В-${pad(dealNumber)}`,
  RELEASE_RECEIPT: (dealNumber: number) => `Р-${pad(dealNumber)}`,
} as const;
