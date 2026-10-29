import type { DealStatus, LegalType, StageStatus } from "@/generated/prisma/enums";

export const DEAL_STATUS: Record<DealStatus, { label: string; tone: Tone }> = {
  PROPOSED: { label: "Согласование условий", tone: "amber" },
  AWAITING_SIGNATURES: { label: "Подписание договора", tone: "blue" },
  AWAITING_FUNDING: { label: "Ожидает оплаты в эскроу", tone: "blue" },
  IN_PROGRESS: { label: "В работе · деньги заморожены", tone: "green" },
  DISPUTE: { label: "Спор", tone: "red" },
  COMPLETED: { label: "Завершена", tone: "neutral" },
  REFUNDED: { label: "Возврат заказчику", tone: "neutral" },
  CANCELLED: { label: "Отменена", tone: "neutral" },
};

export const STAGE_STATUS: Record<StageStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Ожидает", tone: "neutral" },
  IN_PROGRESS: { label: "В работе", tone: "blue" },
  SUBMITTED: { label: "Ждёт подтверждения", tone: "amber" },
  REWORK: { label: "На доработке", tone: "red" },
  APPROVED: { label: "Принят", tone: "green" },
};

export const LEGAL_TYPE: Record<LegalType, string> = {
  SELF_EMPLOYED: "Самозанятый",
  IP: "ИП",
  TOO: "Мебельная компания (ТОО)",
};

export type Tone = "neutral" | "green" | "amber" | "blue" | "red";

export const STEPS = [
  { key: "terms", label: "Условия" },
  { key: "sign", label: "Договор и ЭЦП" },
  { key: "fund", label: "Эскроу" },
  { key: "work", label: "Изготовление" },
  { key: "done", label: "Выплата" },
] as const;

export function stepIndex(status: DealStatus) {
  switch (status) {
    case "PROPOSED":
      return 0;
    case "AWAITING_SIGNATURES":
      return 1;
    case "AWAITING_FUNDING":
      return 2;
    case "IN_PROGRESS":
    case "DISPUTE":
      return 3;
    default:
      return 5;
  }
}

export const FURNITURE_TYPES = [
  "Кухня",
  "Шкаф-купе",
  "Гардеробная",
  "Детская",
  "Прихожая",
  "Мебель из массива",
  "Офисная мебель",
  "Ванная",
];

export const CITIES = ["Астана", "Алматы", "Шымкент", "Караганда"];
