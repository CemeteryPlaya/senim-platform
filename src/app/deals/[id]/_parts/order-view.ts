import type { DealStatus, StageStatus } from "@/generated/prisma/enums";
import type { TimelineState } from "@/ui";

/**
 * Чистые правила экрана «Мой заказ»: какой этап сейчас, состояние кружка на шкале, дата этапа,
 * главное фото и сколько уже оплачено. Без React — проверяются юнит-тестом.
 */

type StageLike = {
  status: StageStatus;
  startedAt: Date | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
  closedAt: Date | null;
  photos: readonly { src: string }[];
  payment: { status: string; amount: number } | null;
};

const FINISHED: ReadonlySet<StageStatus> = new Set(["ACCEPTED", "CLOSED"]);
/** Пока идёт работа по договору, у заказа есть текущий этап. */
const WORKING: ReadonlySet<DealStatus> = new Set(["IN_PROGRESS", "DISPUTE"]);

/** Номер текущего этапа (с нуля): первый незакрытый, пока сделка в работе; иначе null. */
export function currentStageIndex(status: DealStatus, stages: readonly Pick<StageLike, "status">[]): number | null {
  if (!WORKING.has(status)) return null;
  const i = stages.findIndex((s) => !FINISHED.has(s.status));
  return i >= 0 ? i : null;
}

/** Кружок этапа на вертикальной шкале. */
export function stageState(stage: Pick<StageLike, "status">, index: number, current: number | null): TimelineState {
  if (FINISHED.has(stage.status)) return "done";
  return index === current ? "current" : "todo";
}

export type StageDateKind = "closed" | "accepted" | "submitted" | "started";

/** Самая свежая дата этапа и что она значит: закрыт, принят, сдан или начат. */
export function stageDate(stage: Pick<StageLike, "startedAt" | "submittedAt" | "acceptedAt" | "closedAt">): { kind: StageDateKind; at: Date } | null {
  if (stage.closedAt) return { kind: "closed", at: stage.closedAt };
  if (stage.acceptedAt) return { kind: "accepted", at: stage.acceptedAt };
  if (stage.submittedAt) return { kind: "submitted", at: stage.submittedAt };
  if (stage.startedAt) return { kind: "started", at: stage.startedAt };
  return null;
}

/**
 * Главное фото заказа: свежий фотоотчёт (последний этап с фото), иначе фото помещения из заявки,
 * иначе иллюстрация типа мебели; нет ничего — null (карточка покажет заглушку).
 */
export function heroImage(stages: readonly Pick<StageLike, "photos">[], roomPhotos: readonly { src: string }[], illustration: string | null): string | null {
  const report = stages.findLast((s) => s.photos.length > 0);
  return report?.photos[0]?.src ?? roomPhotos[0]?.src ?? illustration;
}

/** Сколько исполнитель подтвердил как полученное (оплата по этапам напрямую). */
export function paidAmount(stages: readonly Pick<StageLike, "payment">[]): number {
  return stages.reduce((sum, s) => sum + (s.payment?.status === "CONFIRMED" ? s.payment.amount : 0), 0);
}
