import type { PaymentMode } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../factories";

/** Исполнитель сделки: из фабрики или зарегистрированный через identity.registerExecutor. */
type DealExecutor = Awaited<ReturnType<typeof makeExecutor>>;

/**
 * Сделка в статусе AWAITING_SIGNATURES с двумя этапами — минимум для тестов documents.
 * Создаётся прямыми запросами (без requests/deal-core), чтобы тесты не зависели от чужих модулей.
 */
export async function makeDeal(opts: { paymentMode?: PaymentMode; legalName?: string; executor?: DealExecutor } = {}) {
  const client = await makeClient("Сапарова Айгерим Болатовна");
  const executor = opts.executor ?? (await makeExecutor({ legalName: opts.legalName ?? "ТОО «Ағаш Шебер»" }));
  const request = await db.request.create({
    data: {
      clientId: client.id,
      mode: "TENDER",
      customType: "Кухня",
      style: "modern",
      details: { widthCm: 320, heightCm: 240, facade: "mdf_enamel", color: "белый" },
      address: "ул. Кенесары, 40, кв. 12",
      wishes: "Без ручек",
      status: "CONTRACTING",
    },
  });
  const offer = await db.offer.create({
    data: {
      requestId: request.id,
      executorId: executor.executor.id,
      price: 1_200_000,
      durationDays: 30,
      warrantyMonths: 12,
      measurementTerms: "FREE",
      status: "ACCEPTED",
    },
  });
  const deal = await db.deal.create({
    data: {
      requestId: request.id,
      offerId: offer.id,
      clientId: client.id,
      executorId: executor.executor.id,
      title: "Кухня угловая",
      totalAmount: 1_250_000,
      paymentMode: opts.paymentMode ?? "MANUAL",
      stageTemplate: "advance-50",
      autoAcceptDays: 5,
      stages: {
        create: [
          { order: 1, title: "Материалы", amount: 625_000, paymentDue: "ON_START" },
          { order: 2, title: "Изготовление и монтаж", amount: 625_000, paymentDue: "ON_ACCEPTANCE" },
        ],
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  return { client, executor, request, offer, deal };
}
