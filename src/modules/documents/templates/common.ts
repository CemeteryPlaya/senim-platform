import type { PaymentDue, PaymentMode } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/ui/format";

/**
 * Редакция шаблонов договора и акта. Владелец решил: пока действует текущий шаблон,
 * юридическая проверка — позже. Текст требует проверки юристом до работы с реальными клиентами;
 * после проверки поднять редакцию и убрать пометку «проект».
 */
export const TEMPLATE_EDITION = "ред. 2026-10, проект до юридической проверки";

export const money = (amount: number) => (amount > 0 ? formatMoney(amount) : "без оплаты");
export const date = formatDate;

export const isEscrow = (mode: PaymentMode) => mode !== "MANUAL";

export const dueLabel: Record<PaymentDue, string> = {
  ON_START: "до начала этапа (аванс)",
  ON_ACCEPTANCE: "после приёмки этапа",
};

/** 1 месяц, 2 месяца, 5 месяцев. */
export function months(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} месяц`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} месяца`;
  return `${n} месяцев`;
}

/** Номера документов: «Д-0014/2026» и «А-0014-2». */
export const contractNumber = (dealNumber: number, year: number) => `Д-${String(dealNumber).padStart(4, "0")}/${year}`;
export const stageActNumber = (dealNumber: number, stageOrder: number) => `А-${String(dealNumber).padStart(4, "0")}-${stageOrder}`;
