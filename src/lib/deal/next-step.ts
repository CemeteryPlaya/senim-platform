import type { DealStatus, Party, StageStatus } from "@/generated/prisma/enums";

type DealLike = {
  status: DealStatus;
  awaitingParty: Party | null;
  revision: number;
  stages: { order: number; title: string; status: StageStatus }[];
  signatures: { party: Party; revision: number }[];
};

/** Что сейчас ожидается в сделке и от кого. Используется для подсказок и бейджей «нужно ваше действие». */
export function nextStep(deal: DealLike): { party: Party | "OPERATOR" | null; text: string } {
  switch (deal.status) {
    case "PROPOSED":
      return deal.awaitingParty === "MASTER"
        ? { party: "MASTER", text: "Мастер рассматривает условия" }
        : { party: "CLIENT", text: "Заказчик рассматривает изменения" };
    case "AWAITING_SIGNATURES": {
      const signed = deal.signatures.filter((s) => s.revision === deal.revision).map((s) => s.party);
      if (!signed.includes("CLIENT") && !signed.includes("MASTER")) return { party: null, text: "Обе стороны подписывают договор" };
      return signed.includes("CLIENT")
        ? { party: "MASTER", text: "Ждём подпись мастера" }
        : { party: "CLIENT", text: "Ждём подпись заказчика" };
    }
    case "AWAITING_FUNDING":
      return { party: "CLIENT", text: "Заказчик пополняет эскроу-счёт" };
    case "IN_PROGRESS": {
      const stage = deal.stages.find((s) => s.status !== "APPROVED");
      if (!stage) return { party: null, text: "Все этапы приняты" };
      if (stage.status === "SUBMITTED") return { party: "CLIENT", text: `Подтвердить этап «${stage.title}»` };
      if (stage.status === "REWORK") return { party: "MASTER", text: `Доработать этап «${stage.title}»` };
      return { party: "MASTER", text: `Мастер выполняет этап «${stage.title}»` };
    }
    case "DISPUTE":
      return { party: "OPERATOR", text: "Спор на рассмотрении оператора" };
    case "COMPLETED":
      return { party: null, text: "Сделка завершена, выплата проведена" };
    case "REFUNDED":
      return { party: null, text: "Средства возвращены заказчику" };
    case "CANCELLED":
      return { party: null, text: "Сделка отменена" };
  }
}

export function needsSigning(deal: DealLike, party: Party) {
  return deal.status === "AWAITING_SIGNATURES" && !deal.signatures.some((s) => s.party === party && s.revision === deal.revision);
}
