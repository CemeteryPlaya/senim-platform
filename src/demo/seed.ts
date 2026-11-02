import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  DealStatus,
  OfferStatus,
  RequestStatus,
  Role,
  StagePaymentStatus,
  StageStatus,
} from "@/generated/prisma/enums";
import { planStages, type PlannedStage } from "@/modules/deal-core/client";
import { signerColumns, type ExecutorSigner } from "@/modules/identity";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { env } from "@/platform/env";
import { DEFAULT_FURNITURE_TYPES, STAGE_TEMPLATES, suggestSegment } from "@/verticals/furniture";
import {
  CLIENTS,
  DEAL_SHOWCASES,
  DUAL_ROLE_REQUESTS,
  EXECUTORS,
  MEASURER,
  NOTIFICATIONS,
  OPERATOR,
  PRE_CONTRACT_REQUESTS,
  PROJECT_MATERIALS,
  REQUESTS,
  STAGE_REPORTS,
  type ClientKey,
  type ClientRef,
  type DealProgress,
  type DealSpec,
  type ExecutorKey,
  type ExecutorSpec,
  type FurnitureSlug,
  type LinkRef,
  type MeasurementSpec,
  type OfferSpec,
  type PersonRef,
  type PersonSpec,
  type RequestSpec,
  type StageStep,
} from "./data";
import { seedDocuments } from "./documents";
import { seedMaterialPrices } from "./materials";
import { PORTFOLIO_FILES } from "./portfolio-files";

/**
 * Демо-данные: seedDemo — в пустую базу, resetDemo — очистка и пересев.
 * Всё в одной транзакции: упавший сид не оставляет полупустую базу.
 * Сервисы модулей не вызываются (их ещё нет и они требуют сессию) — сид пишет состояние
 * и журнал аудита напрямую, сохраняя форму записей recordAudit (src/modules/audit).
 */

type Tx = Prisma.TransactionClient;

export type SeedSummary = { users: number; executors: number; requests: number; deals: number; auditEvents: number };

const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/** Пустая база: нет ни пользователей, ни справочника. Сид не дополняет чужие данные. */
export async function isDatabaseEmpty(client: Pick<PrismaClient, "user" | "furnitureType">): Promise<boolean> {
  return (await client.user.count()) === 0 && (await client.furnitureType.count()) === 0;
}

export async function seedDemo(db: PrismaClient): Promise<SeedSummary> {
  return db.$transaction(async (tx) => {
    if (!(await isDatabaseEmpty(tx))) throw new Error("База не пуста: для пересева используйте resetDemo");
    return fill(tx, Date.now());
  }, TX_OPTIONS);
}

export async function resetDemo(db: PrismaClient): Promise<SeedSummary> {
  return db.$transaction(async (tx) => {
    await truncateAll(tx);
    return fill(tx, Date.now());
  }, TX_OPTIONS);
}

/** TRUNCATE не вызывает триггер append-only журнала аудита (он на UPDATE/DELETE). */
async function truncateAll(tx: Tx) {
  const tables = await tx.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename.replaceAll('"', '""')}"`).join(", ");
  await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// ─── время ───────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const ASTANA_UTC_OFFSET = 5;

type Clock = { ago(days: number): Date; ahead(days: number, astanaHour: number): Date };

function clockAt(now: number): Clock {
  return {
    ago: (days) => new Date(now - days * DAY),
    ahead: (days, hour) => {
      const d = new Date(now + days * DAY);
      d.setUTCHours(hour - ASTANA_UTC_OFFSET, 0, 0, 0);
      return d;
    },
  };
}

// ─── выводимые статусы (единственное место, где решается статус) ─────────────

function activeOffer(spec: RequestSpec): OfferSpec | undefined {
  return spec.offers.find((o) => o.chosen && o.chosen.measurement?.status !== "NO_DEAL");
}

export function requestStatusOf(spec: RequestSpec): RequestStatus {
  if (spec.cancelled) return "CANCELLED";
  if (spec.publishedDaysAgo === undefined) return "DRAFT";
  // Сценарий 2: пока замерщик площадки не снял размеры, исполнители заявку не видят.
  if (spec.flow === "PLATFORM_MEASURER" && spec.offers.length === 0) return "PLATFORM_MEASURING";
  if (spec.deal) return spec.deal.signedDaysAgo !== undefined ? "CLOSED" : "CONTRACTING";
  const active = activeOffer(spec);
  if (!active?.chosen) return "OPEN";
  return active.chosen.measurement ? "MEASURING" : "OFFER_CHOSEN";
}

/** Отклик, присланный до выбора другого (или до отмены заявки), отклоняется в этот момент. */
function offerOutcome(spec: RequestSpec, offer: OfferSpec): { status: OfferStatus; atDaysAgo?: number } {
  if (offer.chosen) {
    const m = offer.chosen.measurement;
    return m?.status === "NO_DEAL" ? { status: "DECLINED", atDaysAgo: m.visitDaysAgo } : { status: "ACCEPTED", atDaysAgo: offer.chosen.daysAgo };
  }
  const closers = [
    ...spec.offers.flatMap((o) => (o.chosen ? [o.chosen.daysAgo] : [])),
    ...(spec.cancelled ? [spec.cancelled.daysAgo] : []),
  ].filter((d) => d < offer.sentDaysAgo);
  return closers.length > 0 ? { status: "DECLINED", atDaysAgo: Math.max(...closers) } : { status: "SENT" };
}

function dealStatusOf(deal: DealSpec): DealStatus {
  if (deal.signedDaysAgo === undefined) return "AWAITING_SIGNATURES";
  if (deal.dispute) return "DISPUTE";
  if (deal.progress === "done") return "COMPLETED";
  return "IN_PROGRESS";
}

// ─── ход этапов по ADR-002 ───────────────────────────────────────────────────

/** Шаги этапа в порядке ADR-002: аванс оплачивается до начала, остальное — после приёмки. */
function stepsOf(stage: PlannedStage): StageStep[] {
  if (stage.amount === 0) return ["started", "submitted", "accepted", "closed"];
  return stage.paymentDue === "ON_START"
    ? ["paymentMarked", "paymentConfirmed", "started", "submitted", "accepted", "closed"]
    : ["started", "submitted", "accepted", "paymentMarked", "paymentConfirmed", "closed"];
}

type StageState = {
  status: StageStatus;
  payment: StagePaymentStatus;
  startedAt?: Date;
  submittedAt?: Date;
  acceptedAt?: Date;
  closedAt?: Date;
  markedPaidAt?: Date;
  confirmedAt?: Date;
};

type StepEvent = { order: number; step: StageStep; at: Date };

/** Проигрывает шаги до точки progress и равномерно раскладывает их между from и to. */
export function stageTimeline(planned: PlannedStage[], progress: DealProgress, from: Date, to: Date) {
  const sequence: { order: number; step: StageStep }[] = [];
  outer: for (const stage of planned) {
    for (const step of stepsOf(stage)) {
      sequence.push({ order: stage.order, step });
      if (progress !== "done" && progress.stage === stage.order && progress.step === step) break outer;
    }
  }
  const last = sequence.at(-1);
  if (progress !== "done" && (last?.order !== progress.stage || last.step !== progress.step)) {
    throw new Error(`Шага ${progress.step} нет у этапа ${progress.stage}`);
  }

  const span = to.getTime() - from.getTime();
  const events: StepEvent[] = sequence.map((s, i) => ({ ...s, at: new Date(from.getTime() + (span * (i + 1)) / sequence.length) }));
  const states: StageState[] = planned.map(() => ({ status: "PENDING", payment: "DUE" }));
  for (const e of events) {
    const st = states[e.order - 1];
    switch (e.step) {
      case "paymentMarked":
        Object.assign(st, { payment: "MARKED_PAID", markedPaidAt: e.at });
        break;
      case "paymentConfirmed":
        Object.assign(st, { payment: "CONFIRMED", confirmedAt: e.at });
        break;
      case "started":
        Object.assign(st, { status: "IN_PROGRESS", startedAt: e.at });
        break;
      case "submitted":
        Object.assign(st, { status: "SUBMITTED", submittedAt: e.at });
        break;
      case "accepted":
        Object.assign(st, { status: "ACCEPTED", acceptedAt: e.at });
        break;
      case "closed":
        Object.assign(st, { status: "CLOSED", closedAt: e.at });
        break;
    }
  }
  return { events, states };
}

const STEP_AUDIT: Record<StageStep, { action: string; by: "client" | "executor" | "system" }> = {
  paymentMarked: { action: "deal.stage.payment.marked", by: "client" },
  paymentConfirmed: { action: "deal.stage.payment.confirmed", by: "executor" },
  started: { action: "deal.stage.started", by: "executor" },
  submitted: { action: "deal.stage.submitted", by: "executor" },
  accepted: { action: "deal.stage.accepted", by: "client" },
  closed: { action: "deal.stage.closed", by: "system" },
};

// ─── журнал аудита ───────────────────────────────────────────────────────────

type AuditActor = { id: string; role: Role } | { system: string };

/** Копит события и пишет их в конце по времени, чтобы seq шёл в хронологическом порядке. */
class AuditLog {
  private rows: Prisma.AuditEventCreateManyInput[] = [];

  add(
    at: Date,
    actor: AuditActor,
    action: string,
    entity: { type: string; id: string },
    scope: string | undefined,
    data: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue; meta?: Prisma.InputJsonObject } = {},
  ) {
    const isUser = "id" in actor;
    this.rows.push({
      actorId: isUser ? actor.id : null,
      actorRole: isUser ? actor.role : "SYSTEM",
      action,
      entityType: entity.type,
      entityId: entity.id,
      scope,
      before: data.before,
      after: data.after,
      meta: isUser ? data.meta : { system: actor.system, ...data.meta },
      createdAt: at,
    });
  }

  async flush(tx: Tx): Promise<number> {
    const sorted = [...this.rows].sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
    await tx.auditEvent.createMany({ data: sorted });
    return sorted.length;
  }
}

// ─── сборка ──────────────────────────────────────────────────────────────────

/** Заказчик заявки сида: персона-заказчик или исполнитель с ролью заказчика (ADR-004). */
function clientIdOf(ids: Ids, ref: ClientRef): string {
  return typeof ref === "string" ? ids.clients.get(ref)! : ids.executors.get(ref.executor)!.userId;
}

type Ids = {
  types: Map<FurnitureSlug, string>;
  operator: string;
  clients: Map<ClientKey, string>;
  executors: Map<ExecutorKey, { userId: string; profileId: string }>;
  portfolio: Map<string, string>;
  requests: Map<string, { id: string; dealId?: string; disputeId?: string }>;
  /** Демо-замерщик площадки (сценарий 2). */
  measurer?: string;
};

/** Подписант договора от исполнителя — как его дала бы анкета (identity.signerOf). */
function signerOf(spec: ExecutorSpec): ExecutorSigner {
  switch (spec.legalForm) {
    case "SELF_EMPLOYED":
      return { fullName: spec.legalName, iin: null };
    case "IP":
      return { fullName: spec.ownerName, iin: null };
    case "TOO":
      return { fullName: spec.person.fullName, iin: spec.person.iin };
  }
}

function personData(p: PersonSpec, role: Role, clock: Clock, roles: Role[] = [role]) {
  return {
    role,
    roles,
    phone: p.phone,
    fullName: p.fullName,
    iinEnc: encryptPii(p.iin),
    iinHash: hashPii(p.iin),
    iinLast4: last4(p.iin),
    isDemo: p.isDemo,
    createdAt: clock.ago(p.joinedDaysAgo),
  };
}

async function fill(tx: Tx, now: number): Promise<SeedSummary> {
  const clock = clockAt(now);
  const audit = new AuditLog();

  await tx.furnitureType.createMany({ data: DEFAULT_FURNITURE_TYPES.map((t, i) => ({ slug: t.slug, name: t.name, sortOrder: i })) });
  const types = new Map((await tx.furnitureType.findMany()).map((t) => [t.slug as FurnitureSlug, t.id]));
  // Демо-цены материалов и типовые расчёты (ADR-007): помечены isDemo, оператор заменит реальными.
  await seedMaterialPrices(tx, types);

  const operator = await tx.user.create({ data: personData(OPERATOR, "OPERATOR", clock) });
  const clients = new Map<ClientKey, string>();
  for (const [key, person] of Object.entries(CLIENTS) as [ClientKey, PersonSpec][]) {
    clients.set(key, (await tx.user.create({ data: personData(person, "CLIENT", clock) })).id);
  }

  const ids: Ids = { types, operator: operator.id, clients, executors: new Map(), portfolio: new Map(), requests: new Map() };
  await seedExecutors(tx, ids, clock, audit);

  const requests = [...REQUESTS].sort((a, b) => b.createdDaysAgo - a.createdDaysAgo);
  const reviews = new Map<ExecutorKey, number[]>();
  for (const spec of requests) await seedRequest(tx, ids, clock, audit, spec, reviews);
  // После остальных: номера заявок и сделок, на которые опираются e2e, не сдвигаются.
  for (const spec of DUAL_ROLE_REQUESTS) await seedRequest(tx, ids, clock, audit, spec, reviews);
  // Сценарии до договора 2–5 (ADR-005) — тоже в конце.
  ids.measurer = (await tx.user.create({ data: personData(MEASURER, "MEASURER", clock) })).id;
  for (const spec of PRE_CONTRACT_REQUESTS) await seedRequest(tx, ids, clock, audit, spec, reviews);
  // Портфолио из итоговых фото сделок (встреча 31.10, п. 3) — последним: новых заявок и сделок не создаёт.
  await seedDealShowcases(tx, ids, clock, audit);

  for (const [key, ratings] of reviews) {
    const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    await tx.executorProfile.update({
      where: { id: ids.executors.get(key)!.profileId },
      data: { ratingAvg: Math.round(avg * 100) / 100, reviewsCount: ratings.length, completedDeals: ratings.length },
    });
  }

  await tx.notification.createMany({
    data: NOTIFICATIONS.map((n) => {
      const createdAt = clock.ago(n.daysAgo);
      return {
        userId: resolvePerson(ids, n.user),
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link ? resolveLink(ids, n.link) : null,
        readAt: n.read ? new Date(createdAt.getTime() + 3_600_000) : null,
        createdAt,
      };
    }),
  });

  const auditEvents = await audit.flush(tx);
  // Документы — после журнала сида: модуль documents сразу пишет свои события, и seq остаётся хронологическим.
  await seedDocuments(tx);
  return {
    users: await tx.user.count(),
    executors: ids.executors.size,
    requests: requests.length + DUAL_ROLE_REQUESTS.length + PRE_CONTRACT_REQUESTS.length,
    deals: await tx.deal.count(),
    auditEvents,
  };
}

async function seedExecutors(tx: Tx, ids: Ids, clock: Clock, audit: AuditLog) {
  // Порядок регистрации задаёт «Исполнитель №N».
  const entries = (Object.entries(EXECUTORS) as [ExecutorKey, ExecutorSpec][]).sort(
    (a, b) => b[1].registeredDaysAgo - a[1].registeredDaysAgo,
  );
  for (const [key, spec] of entries) {
    const roles: Role[] = spec.alsoClient ? ["EXECUTOR", "CLIENT"] : ["EXECUTOR"];
    const user = await tx.user.create({ data: personData(spec.person, "EXECUTOR", clock, roles) });
    const binIin = spec.legalForm === "TOO" ? spec.bin : spec.person.iin;
    const reg = spec.registration;
    const signer = signerOf(spec);
    const profile = await tx.executorProfile.create({
      data: {
        userId: user.id,
        legalForm: spec.legalForm,
        legalName: spec.legalName,
        binIinEnc: encryptPii(binIin),
        binIinHash: hashPii(binIin),
        binIinLast4: last4(binIin),
        ...signerColumns(signer),
        segment: reg.status === "APPROVED" ? reg.segment : null,
        status: reg.status,
        rejectReason: reg.status === "REJECTED" ? reg.rejectReason : null,
        about: spec.about,
        yearsExperience: spec.yearsExperience,
        district: spec.workshop.district,
        streetAddress: spec.workshop.street,
        measurementTerms: spec.measurement,
        measurementFee: spec.measurement === "FEE_IF_NO_DEAL" ? spec.fee : null,
        reviewedAt: reg.status === "PENDING" ? null : clock.ago(reg.reviewedDaysAgo),
        createdAt: clock.ago(spec.registeredDaysAgo),
        specializations: { connect: spec.specializations.map((slug) => ({ id: ids.types.get(slug)! })) },
      },
    });
    ids.executors.set(key, { userId: user.id, profileId: profile.id });

    const scope = `executor:${profile.id}`;
    const entity = { type: "executor", id: profile.id };
    audit.add(clock.ago(spec.registeredDaysAgo), { id: user.id, role: "EXECUTOR" }, "executor.registered", entity, scope, {
      after: { status: "PENDING", legalForm: spec.legalForm },
    });
    if (reg.status === "APPROVED") {
      audit.add(clock.ago(reg.reviewedDaysAgo), { id: ids.operator, role: "OPERATOR" }, "executor.approved", entity, scope, {
        before: { status: "PENDING", segment: null },
        after: { status: "APPROVED", segment: reg.segment },
      });
    } else if (reg.status === "REJECTED") {
      audit.add(clock.ago(reg.reviewedDaysAgo), { id: ids.operator, role: "OPERATOR" }, "executor.rejected", entity, scope, {
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
        meta: { reason: reg.rejectReason },
      });
    }

    for (const [i, item] of spec.portfolio.entries()) {
      const file = PORTFOLIO_FILES[item.file];
      const createdAt = clock.ago(spec.registeredDaysAgo - 1 - i);
      const created = await tx.portfolioItem.create({
        data: {
          executorId: profile.id,
          furnitureTypeId: ids.types.get(item.type)!,
          style: item.style,
          title: item.title,
          description: item.description,
          priceFrom: item.priceFrom,
          place: item.place,
          featured: item.featured ?? false,
          createdAt,
          photos: {
            create: {
              storageKey: `demo/portfolio/${item.file}.svg`,
              provider: "static",
              purpose: "PORTFOLIO",
              contentType: "image/svg+xml",
              size: file.size,
              sha256: file.sha256,
              width: 400,
              height: 300,
              uploadedById: user.id,
              createdAt,
            },
          },
        },
      });
      ids.portfolio.set(item.key, created.id);
    }
  }
}

async function seedRequest(
  tx: Tx,
  ids: Ids,
  clock: Clock,
  audit: AuditLog,
  spec: RequestSpec,
  reviews: Map<ExecutorKey, number[]>,
) {
  const clientId = clientIdOf(ids, spec.client);
  const asClient: AuditActor = { id: clientId, role: "CLIENT" };
  const status = requestStatusOf(spec);
  const signedAt = spec.deal?.signedDaysAgo !== undefined ? clock.ago(spec.deal.signedDaysAgo) : null;

  const request = await tx.request.create({
    data: {
      clientId,
      mode: spec.mode,
      targetExecutorId: spec.mode === "DIRECT" ? ids.executors.get(spec.target)!.profileId : null,
      portfolioItemId: spec.mode === "DIRECT" ? ids.portfolio.get(spec.portfolioItem)! : null,
      furnitureTypeId: ids.types.get(spec.type)!,
      style: spec.style,
      details: { ...spec.details },
      segment: spec.segment,
      segmentSuggested: suggestSegment(spec.details).segment,
      address: spec.address,
      desiredDate: spec.desiredInDays !== undefined ? clock.ahead(spec.desiredInDays, 12) : null,
      wishes: spec.wishes,
      status,
      preContractFlow: spec.publishedDaysAgo !== undefined ? (spec.flow ?? "EXECUTOR_MEASURE") : null,
      wizardStep: spec.wizardStep,
      publishedAt: spec.publishedDaysAgo !== undefined ? clock.ago(spec.publishedDaysAgo) : null,
      closedAt: status === "CLOSED" ? signedAt : spec.cancelled ? clock.ago(spec.cancelled.daysAgo) : null,
      createdAt: clock.ago(spec.createdDaysAgo),
    },
  });
  const ref: { id: string; dealId?: string; disputeId?: string } = { id: request.id };
  ids.requests.set(spec.key, ref);

  const scope = `request:${request.id}`;
  const reqEntity = { type: "request", id: request.id };
  audit.add(clock.ago(spec.createdDaysAgo), asClient, "request.created", reqEntity, scope, { after: { status: "DRAFT" } });
  if (spec.publishedDaysAgo !== undefined) {
    audit.add(clock.ago(spec.publishedDaysAgo), asClient, "request.published", reqEntity, scope, {
      before: { status: "DRAFT" },
      after: { status: status === "PLATFORM_MEASURING" ? status : "OPEN", preContractFlow: spec.flow ?? "EXECUTOR_MEASURE" },
      meta: { mode: spec.mode, segment: spec.segment },
    });
  }

  if (spec.site && ids.measurer) {
    const sm = await tx.siteMeasurement.create({
      data: { requestId: request.id, measurerId: ids.measurer, assignedById: ids.operator, assignedAt: clock.ago(spec.site.assignedDaysAgo) },
    });
    audit.add(clock.ago(spec.site.assignedDaysAgo), { id: ids.operator, role: "OPERATOR" }, "site_measurement.assigned", { type: "siteMeasurement", id: sm.id }, scope, {
      after: { status: "ASSIGNED", measurerId: ids.measurer },
    });
  }

  let dealOffer: { id: string; executor: ExecutorKey; finalPrice: number } | undefined;
  for (const offerSpec of spec.offers) {
    const created = await seedOffer(tx, ids, clock, audit, spec, request.id, offerSpec);
    if (created.finalPrice !== undefined && offerSpec === activeOffer(spec)) {
      dealOffer = { id: created.id, executor: offerSpec.executor, finalPrice: created.finalPrice };
    }
  }

  if (spec.cancelled) {
    audit.add(clock.ago(spec.cancelled.daysAgo), asClient, "request.cancelled", reqEntity, scope, {
      before: { status: "OPEN" },
      after: { status: "CANCELLED" },
      meta: { reason: spec.cancelled.reason },
    });
  }

  if (spec.deal) {
    if (!dealOffer) throw new Error(`Заявка ${spec.key}: для сделки нужен выбранный отклик с замером DONE`);
    await seedDeal(tx, ids, clock, audit, spec, spec.deal, ref, dealOffer, reviews);
  }
}

async function seedOffer(
  tx: Tx,
  ids: Ids,
  clock: Clock,
  audit: AuditLog,
  spec: RequestSpec,
  requestId: string,
  o: OfferSpec,
): Promise<{ id: string; finalPrice?: number }> {
  const executor = ids.executors.get(o.executor)!;
  const terms = EXECUTORS[o.executor] as ExecutorSpec;
  const fee = terms.measurement === "FEE_IF_NO_DEAL" ? terms.fee : null;
  const outcome = offerOutcome(spec, o);
  const offer = await tx.offer.create({
    data: {
      requestId,
      executorId: executor.profileId,
      price: o.price,
      durationDays: o.durationDays,
      warrantyMonths: o.warrantyMonths,
      measurementTerms: terms.measurement,
      measurementFee: fee,
      comment: o.comment,
      status: outcome.status,
      createdAt: clock.ago(o.sentDaysAgo),
    },
  });

  const scope = `request:${requestId}`;
  const asExecutor: AuditActor = { id: executor.userId, role: "EXECUTOR" };
  audit.add(clock.ago(o.sentDaysAgo), asExecutor, "offer.sent", { type: "offer", id: offer.id }, scope, {
    after: { status: "SENT", price: o.price, durationDays: o.durationDays },
  });

  const clientId = clientIdOf(ids, spec.client);
  if (o.messages?.length) {
    await tx.message.createMany({
      data: o.messages.map((m) => ({
        offerId: offer.id,
        senderId: m.from === "client" ? clientId : executor.userId,
        body: m.text,
        wasMasked: m.masked === true,
        createdAt: clock.ago(m.daysAgo),
      })),
    });
  }

  if (!o.chosen) return { id: offer.id };
  audit.add(clock.ago(o.chosen.daysAgo), { id: clientId, role: "CLIENT" }, "offer.accepted", { type: "offer", id: offer.id }, scope, {
    before: { status: "SENT", request: "OPEN" },
    after: { status: "ACCEPTED", request: "OFFER_CHOSEN" },
  });
  const m = o.chosen.measurement;
  if (!m) return { id: offer.id };
  await seedMeasurement(tx, clock, audit, requestId, offer.id, asExecutor, m, fee);
  if (m.status === "DONE") await seedProject(tx, clock, audit, { requestId, offerId: offer.id, asExecutor, asClient: { id: clientId, role: "CLIENT" }, o, m, approved: spec.deal !== undefined });
  return { id: offer.id, finalPrice: m.status === "DONE" ? m.finalPrice : undefined };
}

/**
 * Проект после замера (сценарий 1, ADR-005): у заявок со сделкой — утверждён на итоговую цену,
 * у заявок без сделки — ждёт решения заказчика (основатели проходят шаг «Утверждение проекта»).
 */
async function seedProject(
  tx: Tx,
  clock: Clock,
  audit: AuditLog,
  p: {
    requestId: string;
    offerId: string;
    asExecutor: AuditActor;
    asClient: AuditActor;
    o: OfferSpec;
    m: { visitDaysAgo: number; finalPrice: number };
    approved: boolean;
  },
) {
  const at = clock.ago(Math.max(p.m.visitDaysAgo - 0.1, 0));
  const project = await tx.project.create({
    data: {
      requestId: p.requestId,
      offerId: p.offerId,
      version: 1,
      status: p.approved ? "APPROVED" : "SUBMITTED",
      materials: PROJECT_MATERIALS,
      costLines: [
        { title: "Материалы и фурнитура", amount: Math.round(p.m.finalPrice * 0.6) },
        { title: "Изготовление, доставка и монтаж", amount: p.m.finalPrice - Math.round(p.m.finalPrice * 0.6) },
      ],
      durationDays: p.o.durationDays,
      warrantyMonths: p.o.warrantyMonths,
      totalPrice: p.m.finalPrice,
      createdAt: at,
      decidedAt: p.approved ? at : null,
    },
  });
  const scope = `request:${p.requestId}`;
  const entity = { type: "project", id: project.id };
  audit.add(at, p.asExecutor, "project.submitted", entity, scope, { after: { status: "SUBMITTED", version: 1, totalPrice: p.m.finalPrice } });
  if (p.approved) {
    audit.add(at, p.asClient, "project.approved", entity, scope, { before: { status: "SUBMITTED" }, after: { status: "APPROVED", version: 1, totalPrice: p.m.finalPrice } });
  }
}

async function seedMeasurement(
  tx: Tx,
  clock: Clock,
  audit: AuditLog,
  requestId: string,
  offerId: string,
  asExecutor: AuditActor,
  m: MeasurementSpec,
  fee: number | null,
) {
  const scheduledAt = m.status === "SCHEDULED" ? clock.ahead(m.inDays, 11) : clock.ago(m.visitDaysAgo);
  const feeAccrued = m.status === "NO_DEAL" ? fee : null;
  const measurement = await tx.measurement.create({
    data: {
      offerId,
      requestId,
      scheduledAt,
      status: m.status,
      result: m.status === "SCHEDULED" ? null : m.result,
      finalPrice: m.status === "DONE" ? m.finalPrice : null,
      feeAccrued,
      doneAt: m.status === "SCHEDULED" ? null : scheduledAt,
      createdAt: clock.ago(m.bookedDaysAgo),
    },
  });

  const scope = `request:${requestId}`;
  const entity = { type: "measurement", id: measurement.id };
  audit.add(clock.ago(m.bookedDaysAgo), asExecutor, "measurement.scheduled", entity, scope, {
    before: { request: "OFFER_CHOSEN" },
    after: { status: "SCHEDULED", scheduledAt: scheduledAt.toISOString(), request: "MEASURING" },
  });
  if (m.status === "DONE") {
    audit.add(scheduledAt, asExecutor, "measurement.done", entity, scope, { after: { status: "DONE", finalPrice: m.finalPrice } });
  } else if (m.status === "NO_DEAL") {
    audit.add(scheduledAt, asExecutor, "measurement.no_deal", entity, scope, {
      after: { status: "NO_DEAL", feeAccrued },
      meta: { note: "Плата за выезд оплачивается напрямую исполнителю; платформа только фиксирует запись" },
    });
    audit.add(scheduledAt, { system: "requests" }, "request.reopened", { type: "request", id: requestId }, scope, {
      before: { status: "MEASURING" },
      after: { status: "OPEN" },
      meta: { offerId },
    });
  }
}

async function seedDeal(
  tx: Tx,
  ids: Ids,
  clock: Clock,
  audit: AuditLog,
  spec: RequestSpec,
  d: DealSpec,
  ref: { id: string; dealId?: string; disputeId?: string },
  offer: { id: string; executor: ExecutorKey; finalPrice: number },
  reviews: Map<ExecutorKey, number[]>,
) {
  const template = STAGE_TEMPLATES[d.template];
  const planned = planStages(template, offer.finalPrice);
  const executor = ids.executors.get(offer.executor)!;
  const clientId = clientIdOf(ids, spec.client);
  const status = dealStatusOf(d);
  const createdAt = clock.ago(d.createdDaysAgo);
  const signedAt = d.signedDaysAgo !== undefined ? clock.ago(d.signedDaysAgo) : null;
  const autoAcceptDays = env().AUTO_ACCEPT_DAYS;

  if (d.progress && (!signedAt || d.lastStepDaysAgo === undefined)) {
    throw new Error(`Сделка «${d.title}»: ход этапов возможен только после подписания и с lastStepDaysAgo`);
  }
  const timeline =
    d.progress && signedAt && d.lastStepDaysAgo !== undefined
      ? stageTimeline(planned, d.progress, signedAt, clock.ago(d.lastStepDaysAgo))
      : { events: [] as StepEvent[], states: planned.map((): StageState => ({ status: "PENDING", payment: "DUE" })) };
  const finishedAt = status === "COMPLETED" ? clock.ago(d.lastStepDaysAgo!) : null;

  const deal = await tx.deal.create({
    data: {
      requestId: ref.id,
      offerId: offer.id,
      clientId,
      executorId: executor.profileId,
      title: d.title,
      totalAmount: offer.finalPrice,
      paymentMode: "MANUAL",
      status,
      stageTemplate: template.key,
      autoAcceptDays,
      createdAt,
      signedAt,
      completedAt: finishedAt,
      closedAt: finishedAt,
      stages: {
        create: planned.map((p, i) => {
          const st = timeline.states[i];
          const submittedNow = st.status === "SUBMITTED" && !d.dispute; // спор приостанавливает автоприёмку
          return {
            order: p.order,
            title: p.title,
            description: p.description,
            amount: p.amount,
            paymentDue: p.paymentDue,
            status: st.status,
            report: st.submittedAt ? (STAGE_REPORTS[p.title] ?? "Этап выполнен, фото во вложении.") : null,
            startedAt: st.startedAt,
            submittedAt: st.submittedAt,
            autoAcceptAt: submittedNow && st.submittedAt ? new Date(st.submittedAt.getTime() + autoAcceptDays * DAY) : null,
            acceptedAt: st.acceptedAt,
            acceptedBy: st.acceptedAt ? clientId : null,
            closedAt: st.closedAt,
            payment:
              p.amount > 0
                ? {
                    create: {
                      amount: p.amount,
                      status: st.payment,
                      markedPaidAt: st.markedPaidAt,
                      confirmedAt: st.confirmedAt,
                      createdAt: signedAt ?? createdAt,
                    },
                  }
                : undefined,
          };
        }),
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  ref.dealId = deal.id;

  const scope = `deal:${deal.id}`;
  const reqScope = `request:${ref.id}`;
  const asClient: AuditActor = { id: clientId, role: "CLIENT" };
  const asExecutor: AuditActor = { id: executor.userId, role: "EXECUTOR" };
  const dealEntity = { type: "deal", id: deal.id };

  audit.add(createdAt, asClient, "deal.created", dealEntity, scope, {
    after: { status: "AWAITING_SIGNATURES", totalAmount: deal.totalAmount, stageTemplate: template.key, paymentMode: "MANUAL" },
    meta: { requestId: ref.id, offerId: offer.id },
  });
  audit.add(createdAt, asClient, "request.contracting", { type: "request", id: ref.id }, reqScope, {
    before: { status: "MEASURING" },
    after: { status: "CONTRACTING" },
    meta: { dealId: deal.id },
  });
  if (signedAt) {
    audit.add(signedAt, { system: "documents" }, "deal.signed", dealEntity, scope, {
      before: { status: "AWAITING_SIGNATURES" },
      after: { status: "IN_PROGRESS" },
    });
    audit.add(signedAt, { system: "requests" }, "request.closed", { type: "request", id: ref.id }, reqScope, {
      before: { status: "CONTRACTING" },
      after: { status: "CLOSED" },
      meta: { dealId: deal.id },
    });
  }

  for (const e of timeline.events) {
    const stage = deal.stages[e.order - 1];
    const { action, by } = STEP_AUDIT[e.step];
    const actor: AuditActor = by === "client" ? asClient : by === "executor" ? asExecutor : { system: "deal-core" };
    audit.add(e.at, actor, action, { type: "stage", id: stage.id }, scope, {
      meta: { order: stage.order, title: stage.title, amount: stage.amount },
    });
  }

  if (finishedAt) {
    audit.add(finishedAt, { system: "deal-core" }, "deal.completed", dealEntity, scope, {
      before: { status: "IN_PROGRESS" },
      after: { status: "COMPLETED" },
    });
  }

  if (d.review) {
    const reviewAt = clock.ago(d.review.daysAgo);
    const review = await tx.review.create({
      data: { dealId: deal.id, executorId: executor.profileId, authorId: clientId, rating: d.review.rating, text: d.review.text, createdAt: reviewAt },
    });
    audit.add(reviewAt, asClient, "review.created", { type: "review", id: review.id }, scope, { after: { rating: d.review.rating } });
    reviews.set(offer.executor, [...(reviews.get(offer.executor) ?? []), d.review.rating]);
  }

  if (d.dispute) {
    if (d.progress === undefined || d.progress === "done") throw new Error(`Сделка «${d.title}»: спор открывается по текущему этапу`);
    const stage = deal.stages[d.progress.stage - 1];
    const openedAt = clock.ago(d.dispute.daysAgo);
    const dispute = await tx.dispute.create({
      data: {
        dealId: deal.id,
        stageId: stage.id,
        openedById: clientId,
        reason: d.dispute.reason,
        description: d.dispute.description,
        clientPosition: d.dispute.clientPosition,
        executorPosition: d.dispute.executorPosition,
        status: "OPEN",
        createdAt: openedAt,
      },
    });
    ref.disputeId = dispute.id;
    const entity = { type: "dispute", id: dispute.id };
    audit.add(openedAt, asClient, "dispute.opened", entity, scope, {
      before: { deal: "IN_PROGRESS" },
      after: { deal: "DISPUTE", reason: d.dispute.reason },
      meta: { stageId: stage.id },
    });
    audit.add(new Date(openedAt.getTime() + 0.2 * DAY), asExecutor, "dispute.position.submitted", entity, scope);
  }
}

// ─── ссылки уведомлений ──────────────────────────────────────────────────────

/**
 * Итоговые фото последнего этапа завершённой сделки, согласие заказчика на показ и (если задано) уже
 * добавленная работа со ссылками на эти фото. Файлы static — копии демо-SVG в public/demo/deals/.
 */
async function seedDealShowcases(tx: Tx, ids: Ids, clock: Clock, audit: AuditLog) {
  for (const spec of DEAL_SHOWCASES) {
    const dealId = ids.requests.get(spec.request)?.dealId;
    if (!dealId) throw new Error(`Сделка для витрины не найдена: ${spec.request}`);
    const deal = await tx.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { clientId: true, executorId: true, executor: { select: { userId: true } }, request: { select: { furnitureTypeId: true, style: true } } },
    });
    const lastStage = await tx.stage.findFirstOrThrow({ where: { dealId }, orderBy: { order: "desc" }, select: { id: true, submittedAt: true } });
    const uploadedAt = lastStage.submittedAt ?? clock.ago(spec.consentDaysAgo + 1);
    const fileIds: string[] = [];
    for (const [i, source] of spec.photos.entries()) {
      const meta = PORTFOLIO_FILES[source];
      const file = await tx.storedFile.create({
        data: {
          storageKey: `demo/deals/${spec.request}-${i + 1}.svg`,
          provider: "static",
          purpose: "STAGE_REPORT",
          contentType: "image/svg+xml",
          size: meta.size,
          sha256: meta.sha256,
          width: 400,
          height: 300,
          uploadedById: deal.executor.userId,
          stageId: lastStage.id,
          sortOrder: i,
          createdAt: uploadedAt,
        },
      });
      fileIds.push(file.id);
    }

    const consentAt = clock.ago(spec.consentDaysAgo);
    await tx.deal.update({ where: { id: dealId }, data: { portfolioConsentAt: consentAt } });
    audit.add(consentAt, { id: deal.clientId, role: "CLIENT" }, "portfolio.consent_given", { type: "deal", id: dealId }, `deal:${dealId}`, { after: { consent: true } });

    if (!spec.item) continue;
    const createdAt = clock.ago(spec.item.daysAgo);
    const item = await tx.portfolioItem.create({
      data: {
        executorId: deal.executorId,
        dealId,
        furnitureTypeId: deal.request.furnitureTypeId!,
        style: deal.request.style ?? "modern",
        title: spec.item.title,
        description: spec.item.description,
        place: spec.item.place,
        createdAt,
        dealPhotos: { create: fileIds.map((fileId, sortOrder) => ({ fileId, sortOrder })) },
      },
    });
    audit.add(createdAt, { id: deal.executor.userId, role: "EXECUTOR" }, "portfolio.created_from_deal", { type: "portfolio_item", id: item.id }, `executor:${deal.executorId}`, {
      after: { dealId, photos: fileIds.length, published: true },
    });
  }
}

function resolvePerson(ids: Ids, p: PersonRef): string {
  if ("client" in p) return ids.clients.get(p.client)!;
  if ("executor" in p) return ids.executors.get(p.executor)!.userId;
  return ids.operator;
}

function resolveLink(ids: Ids, link: LinkRef): string {
  if (link.to === "operatorExecutor") return `/operator/executors/${ids.executors.get(link.executor)!.profileId}`;
  const ref = ids.requests.get(link.request);
  if (!ref) throw new Error(`Нет заявки ${link.request} для ссылки уведомления`);
  switch (link.to) {
    case "request":
      return `/requests/${ref.id}`;
    case "executorRequest":
      return `/executor/requests/${ref.id}`;
    case "deal":
      if (!ref.dealId) throw new Error(`У заявки ${link.request} нет сделки`);
      return `/deals/${ref.dealId}`;
    case "operatorDispute":
      if (!ref.disputeId) throw new Error(`У заявки ${link.request} нет спора`);
      return `/operator/disputes/${ref.disputeId}`;
  }
}
