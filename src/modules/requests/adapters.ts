import "server-only";
import { recordAudit, SYSTEM } from "@/modules/audit";
import type { PublicExecutorView } from "@/modules/companies";
import { planStages, type CreateDeal } from "@/modules/deal-core";
import { activeRailMode, type RailMode } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";

/**
 * Временные рабочие адаптеры к модулям, которые пишутся параллельно (фаза B).
 * Сигнатуры — из контрактов фазы A; интегратор заменяет тела на вызовы модулей.
 */

const RAIL_TO_MODE: Record<RailMode, "MANUAL" | "ESCROW_SIMULATOR" | "BANK"> = {
  manual: "MANUAL",
  "escrow-simulator": "ESCROW_SIMULATOR",
  bank: "BANK",
};

// INTEGRATOR: заменить на deal-core.createDeal (контракт CreateDeal). Адаптер создаёт сделку,
// этапы и оплаты этапов по шаблону — без договора и документов (их создаёт deal-core).
export const createDeal: CreateDeal = async (tx, input) => {
  const paymentMode = RAIL_TO_MODE[await activeRailMode()];
  const stages = planStages(input.template, input.totalAmount);
  const deal = await tx.deal.create({
    data: {
      requestId: input.requestId,
      offerId: input.offerId,
      clientId: input.clientId,
      executorId: input.executorId,
      title: input.title,
      totalAmount: input.totalAmount,
      paymentMode,
      stageTemplate: input.template.key,
      autoAcceptDays: env().AUTO_ACCEPT_DAYS,
      stages: {
        create: stages.map((s) => ({ ...s, payment: s.amount > 0 ? { create: { amount: s.amount } } : undefined })),
      },
    },
  });
  await recordAudit(tx, {
    actor: SYSTEM("requests.createDeal-adapter"),
    action: "deal.created",
    entity: { type: "deal", id: deal.id },
    scope: `deal:${deal.id}`,
    after: { status: deal.status, totalAmount: deal.totalAmount, paymentMode, template: input.template.key },
    meta: { requestId: input.requestId, offerId: input.offerId },
  });
  return { dealId: deal.id };
};

// INTEGRATOR: заменить на companies.publicExecutorView (контракт GetPublicExecutorView).
// Выбираются только публичные поля: наименование, ФИО, телефон и ИИН/БИН сюда не попадают.
export async function publicExecutorView(executorId: string): Promise<PublicExecutorView> {
  const p = await db.executorProfile.findUnique({
    where: { id: executorId },
    select: {
      id: true,
      publicNumber: true,
      segment: true,
      ratingAvg: true,
      reviewsCount: true,
      completedDeals: true,
      yearsExperience: true,
      measurementTerms: true,
      measurementFee: true,
      specializations: { select: { slug: true, name: true } },
    },
  });
  if (!p) return fail.notFound();
  return { ...p, label: ru.common.executorLabel(p.publicNumber) };
}

type FileRef = { id: string; provider: string; storageKey: string };

// INTEGRATOR: заменить на URL из модуля files (подписанная ссылка /api/files/...).
// Демо-файлы сида лежат в public/ (provider = "static").
export function fileSrc(file: FileRef): string {
  return file.provider === "static" ? `/${file.storageKey}` : `/api/files/${file.id}`;
}

export type PortfolioPreview = { id: string; title: string; style: string; photos: { src: string; alt: string }[] };

// INTEGRATOR: заменить на публичное портфолио из companies, когда оно появится в index.ts.
export async function executorPortfolio(executorId: string, take = 6): Promise<{ items: PortfolioPreview[]; total: number }> {
  const where = { executorId, published: true };
  const [rows, total] = await Promise.all([
    db.portfolioItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        title: true,
        style: true,
        photos: { orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } },
      },
    }),
    db.portfolioItem.count({ where }),
  ]);
  const items = rows.map((r) => ({ id: r.id, title: r.title, style: r.style, photos: r.photos.map((f) => ({ src: fileSrc(f), alt: r.title })) }));
  return { items, total };
}

export type ReviewView = { id: string; rating: number; text: string; createdAt: Date };

// INTEGRATOR: заменить на отзывы из companies. Автор не раскрывается.
export async function executorReviews(executorId: string, take = 5): Promise<ReviewView[]> {
  return db.review.findMany({
    where: { executorId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, rating: true, text: true, createdAt: true },
  });
}

export type ChatLine = { id: string; mine: boolean; text: string; sentAt: Date; masked: boolean };

// INTEGRATOR: заменить на чат companies (_components/chat): отправка с маскировкой контактов.
// Пока — только чтение истории сообщений отклика.
export async function offerMessages(offerId: string, viewerId: string): Promise<ChatLine[]> {
  const rows = await db.message.findMany({ where: { offerId }, orderBy: { createdAt: "asc" }, take: 200 });
  return rows.map((m) => ({ id: m.id, mine: m.senderId === viewerId, text: m.body, sentAt: m.createdAt, masked: m.wasMasked }));
}
