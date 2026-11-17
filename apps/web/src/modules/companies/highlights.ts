import "server-only";
import { z } from "zod";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { previewUrl } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, isUniqueViolation, transaction, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { NAME_MASK_SELECT, VISIBLE_EXECUTOR } from "./catalog";
import { maskPublicText } from "./mask";
import { requireExecutor } from "./own";
import { DEAL_PHOTOS, itemFiles, OWN_PHOTOS, toPhotoViews } from "./photos";

/**
 * «Лучшие работы» мастера: до 6 опубликованных работ портфолио и/или оконченных сделок, где покупатель разрешил показ фото.
 * Витрина читается каждый раз заново: показ, снятый покупателем, или снятая с публикации работа выпадают сразу.
 * companies не импортирует deal-core (обратная зависимость), поэтому правило «оконченная с офертой» здесь — по данным сделки.
 */
export const HIGHLIGHTS_MAX = 6;
/** Ссылка на фото сделки живёт час — как фото в истории сделок на странице мастера. */
const PHOTO_URL_TTL_SEC = 60 * 60;
/** Конечные статусы сделки (как deal-core ENDED_DEAL; companies deal-core не импортирует). */
const ENDED: DealStatus[] = ["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"];

const t = ru.companies.highlights.errors;

export type HighlightRef = { kind: "work" | "deal"; id: string };
export type HighlightCard = {
  kind: "work" | "deal";
  id: string;
  title: string;
  photo: { src: string; alt: string } | null;
  /** Страницы работы в v2 пока нет; у сделки страницы нет никогда. */
  href: string | null;
};
export type HighlightCandidate = HighlightCard & { selected: boolean; position: number | null };

const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("work"), id: z.string().min(1) }),
  z.object({ kind: z.literal("deal"), id: z.string().min(1) }),
]);
const highlightsSchema = z
  .object({ items: z.array(refSchema).max(HIGHLIGHTS_MAX, t.tooMany(HIGHLIGHTS_MAX)) })
  .refine((v) => new Set(v.items.map((i) => `${i.kind}:${i.id}`)).size === v.items.length, { message: t.duplicate, path: ["items"] });

function requireApprovedExecutor(user: CurrentUser): string {
  const { executorId } = requireExecutor(user);
  if (user.executor?.status !== "APPROVED") return fail.forbidden(t.approvedOnly);
  return executorId;
}

const refsOf = (rows: { portfolioItemId: string | null; dealId: string | null }[]) =>
  rows.map((r) => (r.dealId ? { kind: "deal" as const, id: r.dealId } : { kind: "work" as const, id: r.portfolioItemId ?? "" }));

/** Заменяет набор целиком: проверка каждой работы и сделки, затем deleteMany + createMany в одной транзакции. */
export async function setHighlights(user: CurrentUser, raw: { items: HighlightRef[] }): Promise<void> {
  const executorId = requireApprovedExecutor(user);
  const { items } = parseInput(highlightsSchema, raw);
  const workIds = items.filter((i) => i.kind === "work").map((i) => i.id);
  const dealIds = items.filter((i) => i.kind === "deal").map((i) => i.id);

  await transaction(async (tx) => {
    const [works, deals, before] = await Promise.all([
      tx.portfolioItem.findMany({ where: { id: { in: workIds }, executorId }, select: { id: true, published: true, dealId: true } }),
      tx.deal.findMany({ where: { id: { in: dealIds }, executorId }, select: { id: true, status: true, signedAt: true, showcase: { select: { photos: true } } } }),
      tx.executorHighlight.findMany({ where: { executorId }, orderBy: { position: "asc" }, select: { portfolioItemId: true, dealId: true } }),
    ]);
    if (works.length !== workIds.length || deals.length !== dealIds.length) fail.notFound(t.notFound);
    for (const w of works) {
      if (!w.published) fail.validation(t.workNotPublished);
      if (w.dealId !== null) fail.validation(t.workFromDeal);
    }
    for (const d of deals) {
      if (!ENDED.includes(d.status) || d.signedAt === null || d.showcase?.photos !== true) fail.validation(t.dealNotShowable);
    }

    await tx.executorHighlight.deleteMany({ where: { executorId } });
    await tx.executorHighlight.createMany({
      data: items.map((it, position) => ({ executorId, position, ...(it.kind === "work" ? { portfolioItemId: it.id } : { dealId: it.id }) })),
    });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "executor.highlights.changed",
      entity: { type: "executor", id: executorId },
      scope: `executor:${executorId}`,
      before: { items: refsOf(before) },
      after: { items },
    });
  }).catch((e: unknown) => {
    // Две одновременные замены одним мастером: уникальность работы, сделки или позиции.
    if (isUniqueViolation(e)) return fail.conflict(t.notFound);
    throw e;
  });
}

const WORK_SELECT = {
  id: true,
  title: true,
  photos: { ...OWN_PHOTOS, take: 1 },
  dealPhotos: { ...DEAL_PHOTOS, take: 1 },
} satisfies Prisma.PortfolioItemSelect;

const DEAL_SELECT = {
  id: true,
  title: true,
  deliveryPhotos: {
    where: { purpose: "DELIVERY" },
    select: { id: true, provider: true, storageKey: true, previewKey: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 1,
  },
} satisfies Prisma.DealSelect;

type WorkRow = Prisma.PortfolioItemGetPayload<{ select: typeof WORK_SELECT }>;
type DealRow = Prisma.DealGetPayload<{ select: typeof DEAL_SELECT }>;
type Mask = (text: string) => string;

async function workCard(row: WorkRow, mask: Mask): Promise<HighlightCard> {
  const title = mask(row.title);
  const [cover] = await toPhotoViews(itemFiles(row).slice(0, 1), (n) => ru.companies.photoAlt(title, n));
  return { kind: "work", id: row.id, title, photo: cover?.src ? { src: cover.src, alt: cover.alt } : null, href: null };
}

async function dealCard(row: DealRow, mask: Mask): Promise<HighlightCard> {
  const title = mask(row.title);
  const file = row.deliveryPhotos[0];
  const photo = file ? { src: await previewUrl(file, { expiresInSec: PHOTO_URL_TTL_SEC }), alt: ru.companies.photoAlt(title, 1) } : null;
  return { kind: "deal", id: row.id, title, photo, href: null };
}

const ENDED_SHOWN = { status: { in: ENDED }, signedAt: { not: null }, showcase: { photos: true } } satisfies Prisma.DealWhereInput;

/** Витрина на публичной странице: мастер виден, порядок по position, закрытое покупателем и снятое с публикации — не показывается. */
export async function publicHighlights(executorId: string): Promise<HighlightCard[]> {
  const executor = await db.executorProfile.findFirst({ where: { id: executorId, ...VISIBLE_EXECUTOR }, select: NAME_MASK_SELECT });
  if (!executor) return [];
  const rows = await db.executorHighlight.findMany({
    where: { executorId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      portfolioItem: { select: { ...WORK_SELECT, published: true, dealId: true, furnitureType: { select: { active: true } } } },
      deal: { select: { ...DEAL_SELECT, status: true, signedAt: true, executorId: true, showcase: { select: { photos: true } } } },
    },
  });
  const mask: Mask = (text) => maskPublicText(text, executor).text;
  const cards = await Promise.all(
    rows.map(async ({ portfolioItem: w, deal: d }): Promise<HighlightCard | null> => {
      if (w) return w.published && w.dealId === null && w.furnitureType.active ? workCard(w, mask) : null;
      if (d) return ENDED.includes(d.status) && d.signedAt !== null && d.executorId === executorId && d.showcase?.photos === true ? dealCard(d, mask) : null;
      return null;
    }),
  );
  return cards.filter((c): c is HighlightCard => c !== null);
}

/**
 * Кандидаты мастера: свои опубликованные работы без сделки и оконченные сделки с «фото: да», с пометкой выбора.
 * `hiddenDeals` — свои оконченные сделки с офертой, где покупатель не разрешил показ фото (в кандидатах их нет).
 */
export async function listHighlightCandidates(user: CurrentUser): Promise<{ items: HighlightCandidate[]; hiddenDeals: number }> {
  const executorId = requireApprovedExecutor(user);
  const [executor, works, deals, chosen, hiddenDeals] = await Promise.all([
    db.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: NAME_MASK_SELECT }),
    db.portfolioItem.findMany({ where: { executorId, published: true, dealId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: WORK_SELECT }),
    db.deal.findMany({ where: { executorId, ...ENDED_SHOWN }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: DEAL_SELECT }),
    db.executorHighlight.findMany({ where: { executorId }, select: { portfolioItemId: true, dealId: true, position: true } }),
    db.deal.count({ where: { executorId, status: { in: ENDED }, signedAt: { not: null }, NOT: { showcase: { photos: true } } } }),
  ]);
  const mask: Mask = (text) => maskPublicText(text, executor).text;
  const position = new Map(chosen.map((c) => [c.dealId ?? c.portfolioItemId ?? "", c.position]));
  const mark = (card: HighlightCard): HighlightCandidate => ({ ...card, selected: position.has(card.id), position: position.get(card.id) ?? null });
  const cards = await Promise.all([...works.map((w) => workCard(w, mask)), ...deals.map((d) => dealCard(d, mask))]);
  return { items: cards.map(mark), hiddenDeals };
}
