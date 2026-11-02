import { scopeHistory } from "@/modules/audit";
import { resolveDispute as resolveDisputeInDealCore } from "@/modules/deal-core";
import { fileUrl } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { computeSplit, moneyHistory, moneyView, type Split } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { assertOperator } from "./access";
import { toAuditView } from "./audit-view";
import type { ResolveDisputeFormInput } from "./schemas";

/** Очередь споров: сначала открытые (по дате открытия), затем решённые. */
export async function listDisputes(user: CurrentUser) {
  assertOperator(user);
  return db.dispute.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      status: true,
      reason: true,
      outcome: true,
      openedInStatus: true,
      createdAt: true,
      resolvedAt: true,
      deal: { select: { id: true, number: true, title: true, priceTiyn: true } },
    },
  });
}

/**
 * Карточка спора: позиции сторон, вложения, этап сделки при открытии, деньги сделки из журнала
 * (блок и история денег) и вся история сделки из журнала аудита.
 */
export async function getDisputeCard(user: CurrentUser, disputeId: string) {
  assertOperator(user);
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      status: true,
      reason: true,
      description: true,
      clientPosition: true,
      executorPosition: true,
      openedInStatus: true,
      outcome: true,
      masterShareTiyn: true,
      rationale: true,
      createdAt: true,
      resolvedAt: true,
      openedBy: { select: { role: true } },
      resolvedBy: { select: { fullName: true } },
      attachments: {
        select: { id: true, contentType: true, size: true, sha256: true, createdAt: true, provider: true, storageKey: true },
        orderBy: { sortOrder: "asc" },
      },
      deal: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priceTiyn: true,
          buyerTotalTiyn: true,
          payoutTiyn: true,
          paymentProvider: true,
          client: { select: { fullName: true } },
          executor: { select: { publicNumber: true, legalName: true } },
        },
      },
    },
  });
  if (!dispute) return fail.notFound();
  const [history, money, moneyItems] = await Promise.all([
    scopeHistory(`deal:${dispute.deal.id}`).then((events) => events.map(toAuditView)),
    moneyView(dispute.deal.id),
    moneyHistory(dispute.deal.id),
  ]);
  // Подписанная ссылка на просмотр; ключ хранилища наружу не отдаём.
  const attachments = await Promise.all(
    dispute.attachments.map(async ({ provider, storageKey, ...a }) => ({ ...a, url: await fileUrl({ provider, storageKey }) })),
  );
  // Подсказка ИИ по спору — только при флаге ai (ADR-009 раздел 3); своего кода подсказки у спора пока нет.
  return { ...dispute, attachments, history, money, moneyHistory: moneyItems, aiHintEnabled: isEnabled("ai") };
}

/**
 * Предварительный расчёт раздела: мастеру Y из цены X — сколько получит мастер, сколько доход платформы
 * и сколько вернётся покупателю. Та же функция payments.computeSplit, что и при решении.
 */
export async function previewDisputeSplit(user: CurrentUser, input: { disputeId: string; masterShareKzt: number }): Promise<Split & { shareTiyn: bigint }> {
  assertOperator(user);
  const dispute = await db.dispute.findUnique({ where: { id: input.disputeId }, select: { deal: { select: { priceTiyn: true } } } });
  if (!dispute) return fail.notFound();
  const shareTiyn = BigInt(input.masterShareKzt) * 100n;
  if (shareTiyn > dispute.deal.priceTiyn) {
    const msg = ru.operator.errors.amountTooBig;
    return fail.validation(msg, { fieldErrors: { masterShareKzt: [msg] } });
  }
  return { ...computeSplit(dispute.deal.priceTiyn, shareTiyn), shareTiyn };
}

export async function resolveDispute(user: CurrentUser, input: ResolveDisputeFormInput): Promise<void> {
  assertOperator(user);
  await resolveDisputeInDealCore(user, input);
}
