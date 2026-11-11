import type { User } from "@/gen/senim/identity/v1/identity_pb";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OfferStatus, ProposalStatus, RequestStatus, Role, SignParty } from "@/generated/prisma/enums";
import { saveFile } from "@/modules/files";
import { projectUser, resetIdentityDemo, seedIdentityUsers, type ExecutorSigner, type SeedPerson } from "@/modules/identity";
import { kztToTiyn } from "@/modules/payments";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { registerPorts } from "@/ports";
import { DEFAULT_FURNITURE_TYPES, suggestSegment } from "@/verticals/furniture";
import {
  CLIENTS,
  DUAL_ROLE_REQUESTS,
  EXECUTORS,
  KYC,
  MEASURER,
  NOTIFICATIONS,
  OPERATOR,
  PRE_CONTRACT_REQUESTS,
  PROJECT_MATERIALS,
  REQUESTS,
  type ClientKey,
  type ClientRef,
  type ExecutorKey,
  type ExecutorSpec,
  type FurnitureSlug,
  type KycSpec,
  type LinkRef,
  type MeasurementSpec,
  type OfferSpec,
  type PersonRef,
  type PersonSpec,
  type RequestSpec,
} from "./data";
import { seedDeals, type DealIds } from "./deals";
import { testIban } from "./kz-id";
import { seedMaterialPrices } from "./materials";
import { PORTFOLIO_FILES } from "./portfolio-files";
import { testDocumentPdf } from "./test-documents";

/**
 * Люди сида заводятся в identity (SeedUsers: по телефону, id стабильны) до транзакции старой базы, а в ней
 * проецируются (projectUser) с теми же id — на них ссылаются заявки, профили и сделки.
 * Демо-данные в два шага:
 *  1. «До сделок» — справочник, люди, мастера с KYC, заявки, отклики и торг, сценарии до договора, уведомления —
 *     одной транзакцией с датами «N дней назад» (журнал аудита — в форме recordAudit);
 *  2. сделки (deals.ts) — настоящими сервисами deal-core, documents, payments и operator: оферта, подписи
 *     (mock ЭЦП), оплата, сдача с фото и GPS, акт, споры, выплаты и возвраты, подтверждения оператора на manual.
 *     Сделки — тестовые (Deal.isDemo, операции журнала isTest), суммы — computeDealMoney, документы — PDF documents.
 * Шаг 2 идёт отдельными транзакциями сервисов: упавший сид оставляет базу частично заполненной — повторный
 * запуск через resetDemo (TRUNCATE) начинает с чистой базы.
 */

type Tx = Prisma.TransactionClient;

export type SeedSummary = { users: number; executors: number; requests: number; deals: number; auditEvents: number };

const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/** Пустая база: нет ни пользователей, ни справочника. Сид не дополняет чужие данные. */
export async function isDatabaseEmpty(client: Pick<PrismaClient, "user" | "furnitureType">): Promise<boolean> {
  return (await client.user.count()) === 0 && (await client.furnitureType.count()) === 0;
}

const NOT_EMPTY = "База не пуста: для пересева используйте resetDemo";

export async function seedDemo(db: PrismaClient): Promise<SeedSummary> {
  // До identity: непустая база не меняет и пользователей identity.
  if (!(await isDatabaseEmpty(db))) throw new Error(NOT_EMPTY);
  const now = Date.now();
  const users = await seedIdentityUsers(seedPeople(clockAt(now)));
  const ids = await db.$transaction(async (tx) => {
    if (!(await isDatabaseEmpty(tx))) throw new Error(NOT_EMPTY);
    return fill(tx, now, users);
  }, TX_OPTIONS);
  return finish(db, ids);
}

/** Пересев: в identity — сброс сессий и кодов (ResetDemo) и те же пользователи; старая база — TRUNCATE и сид в одной транзакции. */
export async function resetDemo(db: PrismaClient): Promise<SeedSummary> {
  await resetIdentityDemo();
  const now = Date.now();
  const users = await seedIdentityUsers(seedPeople(clockAt(now)));
  const ids = await db.$transaction(async (tx) => {
    await truncateAll(tx);
    return fill(tx, now, users);
  }, TX_OPTIONS);
  return finish(db, ids);
}

async function finish(db: PrismaClient, ids: DealIds): Promise<SeedSummary> {
  // Сделки идут настоящими сервисами: оферте и акту нужен порт documents (PDF), заявке — порт requests.
  registerPorts();
  await seedDeals(ids);
  return {
    users: await db.user.count(),
    executors: ids.executors.size,
    requests: await db.request.count(),
    deals: await db.deal.count(),
    auditEvents: await db.auditEvent.count(),
  };
}

/** TRUNCATE не вызывает триггер append-only журнала аудита и журнала денег (они на UPDATE/DELETE). */
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

// ─── выводимые статусы (единственное место, где решается статус заявки и отклика) ──

function activeOffer(spec: RequestSpec): OfferSpec | undefined {
  return spec.offers.find((o) => o.chosen && o.chosen.measurement?.status !== "NO_DEAL");
}

/** Статус заявки до сделок. Заявки под сделку — OPEN: CONTRACTING/CLOSED/CANCELLED им ставит путь сделки. */
export function requestStatusOf(spec: RequestSpec): RequestStatus {
  if (spec.cancelled) return "CANCELLED";
  if (spec.publishedDaysAgo === undefined) return "DRAFT";
  // Сценарий 2: пока замерщик площадки не снял размеры, исполнители заявку не видят.
  if (spec.flow === "PLATFORM_MEASURER" && spec.offers.length === 0) return "PLATFORM_MEASURING";
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
  const closers = [...spec.offers.flatMap((o) => (o.chosen ? [o.chosen.daysAgo] : [])), ...(spec.cancelled ? [spec.cancelled.daysAgo] : [])].filter(
    (d) => d < offer.sentDaysAgo,
  );
  return closers.length > 0 ? { status: "DECLINED", atDaysAgo: Math.max(...closers) } : { status: "SENT" };
}

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

type Ids = DealIds & {
  types: Map<FurnitureSlug, string>;
  portfolio: Map<string, string>;
  /** Демо-замерщик площадки (сценарий 2). */
  measurer?: string;
};

/** Заказчик заявки сида: персона-заказчик или исполнитель с ролью заказчика (ADR-004). */
function clientIdOf(ids: Ids, ref: ClientRef): string {
  return typeof ref === "string" ? ids.clients.get(ref)! : ids.executors.get(ref.executor)!.userId;
}

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

/** E-mail для копии подписанного акта (ТЗ п. 7) — у одной демо-персоны, домен example.kz не доставляется. */
const DEMO_EMAILS: Partial<Record<ClientKey, string>> = { aigerim: "aigerim.demo@example.kz" };

const executorRoles = (spec: ExecutorSpec): Role[] => (spec.alsoClient ? ["EXECUTOR", "CLIENT"] : ["EXECUTOR"]);

/** Исполнители сида в порядке регистрации: он задаёт «Исполнитель №N» и тестовый IBAN одобренных. */
const executorsByRegistration = () => (Object.entries(EXECUTORS) as [ExecutorKey, ExecutorSpec][]).sort((a, b) => b[1].registeredDaysAgo - a[1].registeredDaysAgo);

/** Тестовый счёт выплаты: только у одобренного исполнителя; n — место в порядке регистрации. */
const payoutIbanOf = (spec: ExecutorSpec, n: number): string | null => (spec.registration.status === "APPROVED" ? testIban(n + 1) : null);

/**
 * Все люди сида для identity: роли, демо-флаг и дата регистрации — как у них в старой базе; ФИО и ИИН, у исполнителя —
 * сторона со счётом выплаты (договор, подпись ЭЦП и выплата читают их из identity). Сотрудникам ИИН не нужен.
 * Перенос остальных полей (контакты, KYC, согласие) и отказ от шифртекстов старой базы — Task 15 плана 2б.
 */
function seedPeople(clock: Clock): SeedPerson[] {
  const person = (p: PersonSpec, role: Role, roles: Role[] = [role]): SeedPerson => ({
    phone: p.phone,
    role,
    roles,
    isDemo: p.isDemo,
    createdAt: clock.ago(p.joinedDaysAgo),
    fullName: p.fullName,
    iin: p.iin,
  });
  const executor = ([, spec]: [ExecutorKey, ExecutorSpec], n: number): SeedPerson => {
    const signer = signerOf(spec);
    return {
      ...person(spec.person, "EXECUTOR", executorRoles(spec)),
      party: {
        legalForm: spec.legalForm,
        legalName: spec.legalName,
        binIin: spec.legalForm === "TOO" ? spec.bin : null,
        signerFullName: signer.fullName,
        signerIin: signer.iin,
        payoutIban: payoutIbanOf(spec, n),
      },
    };
  };
  const staff = (p: PersonSpec, role: Role): SeedPerson => ({ phone: p.phone, role, roles: [role], isDemo: p.isDemo, createdAt: clock.ago(p.joinedDaysAgo) });
  return [
    staff(OPERATOR, "OPERATOR"),
    ...Object.values(CLIENTS).map((p: PersonSpec) => person(p, "CLIENT")),
    ...executorsByRegistration().map(executor),
    staff(MEASURER, "MEASURER"),
  ];
}

/** Id человека сида в identity (и в старой базе). */
type UserIds = Map<string, string>;

/**
 * Поля старой базы, которых нет в identity (ФИО, ИИН, e-mail), и дата регистрации из сида — поверх проекции
 * (телефон, роли и демо-флаг пишет projectUser).
 */
async function completePerson(tx: Tx, users: UserIds, p: PersonSpec, clock: Clock, email?: string): Promise<string> {
  const id = users.get(p.phone);
  if (!id) throw new Error("Человек сида не заведён в identity");
  await tx.user.update({
    where: { id },
    data: {
      fullName: p.fullName,
      iinEnc: encryptPii(p.iin),
      iinHash: hashPii(p.iin),
      iinLast4: last4(p.iin),
      email: email ?? null,
      createdAt: clock.ago(p.joinedDaysAgo),
    },
  });
  return id;
}

async function fill(tx: Tx, now: number, identityUsers: User[]): Promise<Ids> {
  const clock = clockAt(now);
  const audit = new AuditLog();
  for (const user of identityUsers) await projectUser(user, tx);
  const users: UserIds = new Map(identityUsers.map((u) => [u.phone, u.id]));

  await tx.furnitureType.createMany({ data: DEFAULT_FURNITURE_TYPES.map((t, i) => ({ slug: t.slug, name: t.name, sortOrder: i })) });
  const types = new Map((await tx.furnitureType.findMany()).map((t) => [t.slug as FurnitureSlug, t.id]));
  // Демо-цены материалов и типовые расчёты (ADR-007): помечены isDemo, оператор заменит реальными.
  await seedMaterialPrices(tx, types);

  const operator = await completePerson(tx, users, OPERATOR, clock);
  const clients = new Map<ClientKey, string>();
  for (const [key, person] of Object.entries(CLIENTS) as [ClientKey, PersonSpec][]) {
    clients.set(key, await completePerson(tx, users, person, clock, DEMO_EMAILS[key]));
  }

  const ids: Ids = { types, operator, clients, executors: new Map(), portfolio: new Map(), requests: new Map() };
  await seedExecutors(tx, ids, users, clock, audit);

  const requests = [...REQUESTS].sort((a, b) => b.createdDaysAgo - a.createdDaysAgo);
  for (const spec of requests) await seedRequest(tx, ids, clock, audit, spec);
  for (const spec of DUAL_ROLE_REQUESTS) await seedRequest(tx, ids, clock, audit, spec);
  // Сценарии до договора (флаг preContractFlows, ADR-005) — в конце.
  ids.measurer = await completePerson(tx, users, MEASURER, clock);
  for (const spec of PRE_CONTRACT_REQUESTS) await seedRequest(tx, ids, clock, audit, spec);

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

  await audit.flush(tx);
  return ids;
}

/**
 * Подписант демо-профиля в старой базе (ADR-003): ТОО — ФИО и ИИН директора (шифртекст и HMAC), ИП и самозанятый — ФИО.
 * Демо-сид пока пишет реквизиты в старую базу сам; перенос в identity — Task 15 плана 2б.
 */
function signerColumns(signer: ExecutorSigner) {
  return {
    signerFullName: signer.fullName,
    signerIinEnc: signer.iin === null ? null : encryptPii(signer.iin),
    signerIinHash: signer.iin === null ? null : hashPii(signer.iin),
  };
}

async function seedExecutors(tx: Tx, ids: Ids, users: UserIds, clock: Clock, audit: AuditLog) {
  // Порядок регистрации задаёт «Исполнитель №N».
  for (const [n, [key, spec]] of executorsByRegistration().entries()) {
    const user = { id: await completePerson(tx, users, spec.person, clock) };
    const binIin = spec.legalForm === "TOO" ? spec.bin : spec.person.iin;
    const reg = spec.registration;
    const approved = reg.status === "APPROVED";
    const iban = payoutIbanOf(spec, n);
    const profile = await tx.executorProfile.create({
      data: {
        userId: user.id,
        legalForm: spec.legalForm,
        legalName: spec.legalName,
        binIinEnc: encryptPii(binIin),
        binIinHash: hashPii(binIin),
        binIinLast4: last4(binIin),
        ...signerColumns(signerOf(spec)),
        segment: approved ? reg.segment : null,
        status: reg.status,
        rejectReason: reg.status === "REJECTED" ? reg.rejectReason : null,
        about: spec.about,
        yearsExperience: spec.yearsExperience,
        district: spec.workshop.district,
        streetAddress: spec.workshop.street,
        measurementTerms: spec.measurement,
        measurementFee: spec.measurement === "FEE_IF_NO_DEAL" ? spec.fee : null,
        payoutIbanEnc: iban ? encryptPii(iban) : null,
        payoutIbanLast4: iban ? iban.slice(-4) : null,
        reviewedAt: reg.status === "PENDING" ? null : clock.ago(reg.reviewedDaysAgo),
        createdAt: clock.ago(spec.registeredDaysAgo),
        specializations: { connect: spec.specializations.map((slug) => ({ id: ids.types.get(slug)! })) },
      },
    });
    ids.executors.set(key, { userId: user.id, profileId: profile.id });

    const scope = `executor:${profile.id}`;
    const entity = { type: "executor", id: profile.id };
    audit.add(clock.ago(spec.registeredDaysAgo), { id: user.id, role: "EXECUTOR" }, "executor.registered", entity, scope, { after: { status: "PENDING", legalForm: spec.legalForm } });
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
    const kyc = KYC[key];
    if (kyc) await seedKyc(tx, ids, clock, audit, { userId: user.id, profileId: profile.id, name: spec.person.fullName }, kyc);

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

/** KYC мастера (решение 2.2.8): тестовые документы через files и статус проверки, как после решения оператора. */
async function seedKyc(tx: Tx, ids: Ids, clock: Clock, audit: AuditLog, who: { userId: string; profileId: string; name: string }, kyc: KycSpec) {
  const uploadedAt = clock.ago(kyc.status === "PENDING" ? kyc.uploadedDaysAgo : kyc.reviewedDaysAgo + 1);
  const docs = [
    { purpose: "KYC_ID" as const, title: "Удостоверение личности", lines: [`Владелец: ${who.name}`, "Номер и даты — не указываются в демо"] },
    { purpose: "KYC_REGISTRATION" as const, title: "Регистрация ИП или ТОО", lines: [`Заявитель: ${who.name}`, "Свидетельство — тестовое"] },
  ];
  for (const [i, d] of docs.entries()) {
    const file = await saveFile({ purpose: d.purpose, bytes: await testDocumentPdf(d.title, d.lines, uploadedAt), uploadedById: who.userId, tx });
    await tx.storedFile.update({ where: { id: file.id }, data: { executorProfileId: who.profileId, sortOrder: i, createdAt: uploadedAt } });
  }
  const entity = { type: "executor", id: who.profileId };
  const scope = `executor:${who.profileId}`;
  audit.add(uploadedAt, { id: who.userId, role: "EXECUTOR" }, "executor.kyc_submitted", entity, scope, { before: { status: "PENDING" }, after: { status: "PENDING" }, meta: { idFiles: 1, registrationFiles: 1 } });
  if (kyc.status === "PENDING") return;
  const reviewedAt = clock.ago(kyc.reviewedDaysAgo);
  const reason = kyc.status === "REJECTED" ? kyc.reason : null;
  await tx.executorProfile.update({ where: { id: who.profileId }, data: { kycStatus: kyc.status, kycRejectReason: reason, kycReviewedAt: reviewedAt } });
  audit.add(reviewedAt, { id: ids.operator, role: "OPERATOR" }, kyc.status === "VERIFIED" ? "executor.kyc_verified" : "executor.kyc_rejected", entity, scope, {
    before: { status: "PENDING" },
    after: reason ? { status: kyc.status, reason } : { status: kyc.status },
  });
}

async function seedRequest(tx: Tx, ids: Ids, clock: Clock, audit: AuditLog, spec: RequestSpec) {
  const clientId = clientIdOf(ids, spec.client);
  const asClient: AuditActor = { id: clientId, role: "CLIENT" };
  const status = requestStatusOf(spec);
  const published = spec.publishedDaysAgo !== undefined;
  // Путь ТЗ (торг и оферта) — preContractFlow null; сценарии до договора — снимок сценария (ADR-005).
  const flow = published ? (spec.flow ?? null) : null;

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
      address: spec.address?.text ?? null,
      addressLat: spec.address?.point.lat ?? null,
      addressLng: spec.address?.point.lng ?? null,
      desiredDate: spec.desiredInDays !== undefined ? clock.ahead(spec.desiredInDays, 12) : null,
      wishes: spec.wishes,
      status,
      preContractFlow: flow,
      wizardStep: spec.wizardStep,
      publishedAt: published ? clock.ago(spec.publishedDaysAgo!) : null,
      closedAt: spec.cancelled ? clock.ago(spec.cancelled.daysAgo) : null,
      createdAt: clock.ago(spec.createdDaysAgo),
    },
  });
  const offers: string[] = [];
  ids.requests.set(spec.key, { id: request.id, offers });

  const scope = `request:${request.id}`;
  const reqEntity = { type: "request", id: request.id };
  audit.add(clock.ago(spec.createdDaysAgo), asClient, "request.created", reqEntity, scope, { after: { status: "DRAFT" } });
  if (published) {
    audit.add(clock.ago(spec.publishedDaysAgo!), asClient, "request.published", reqEntity, scope, {
      before: { status: "DRAFT" },
      after: { status: status === "PLATFORM_MEASURING" ? status : "OPEN", preContractFlow: flow },
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

  for (const offerSpec of spec.offers) offers.push(await seedOffer(tx, ids, clock, audit, spec, request.id, flow === null, offerSpec));

  if (spec.cancelled) {
    audit.add(clock.ago(spec.cancelled.daysAgo), asClient, "request.cancelled", reqEntity, scope, {
      before: { status: "OPEN" },
      after: { status: "CANCELLED" },
      meta: { reason: spec.cancelled.reason },
    });
  }
}

async function seedOffer(tx: Tx, ids: Ids, clock: Clock, audit: AuditLog, spec: RequestSpec, requestId: string, tzPath: boolean, o: OfferSpec): Promise<string> {
  const executor = ids.executors.get(o.executor)!;
  const terms = EXECUTORS[o.executor] as ExecutorSpec;
  const fee = terms.measurement === "FEE_IF_NO_DEAL" ? terms.fee : null;
  const outcome = offerOutcome(spec, o);
  const priceTiyn = kztToTiyn(o.price);
  const sentAt = clock.ago(o.sentDaysAgo);
  const offer = await tx.offer.create({
    data: {
      requestId,
      executorId: executor.profileId,
      priceTiyn,
      durationDays: o.durationDays,
      warrantyMonths: o.warrantyMonths,
      measurementTerms: terms.measurement,
      measurementFee: fee,
      comment: o.comment,
      status: outcome.status,
      createdAt: sentAt,
    },
  });

  const scope = `request:${requestId}`;
  const asExecutor: AuditActor = { id: executor.userId, role: "EXECUTOR" };
  audit.add(sentAt, asExecutor, "offer.sent", { type: "offer", id: offer.id }, scope, {
    after: { status: "SENT", priceTiyn: String(priceTiyn), durationDays: o.durationDays, measurementTerms: terms.measurement },
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

  // Путь ТЗ: цена отклика — первое предложение мастера; дальше — встречные цены, последняя ждёт ответа.
  if (tzPath) await seedRounds(tx, clock, audit, { offerId: offer.id, scope, clientId, executorUserId: executor.userId, priceTiyn, sentAt, rounds: o.rounds ?? [] });

  if (!o.chosen) return offer.id;
  audit.add(clock.ago(o.chosen.daysAgo), { id: clientId, role: "CLIENT" }, "offer.accepted", { type: "offer", id: offer.id }, scope, {
    before: { status: "SENT", request: "OPEN" },
    after: { status: "ACCEPTED", request: "OFFER_CHOSEN" },
  });
  const m = o.chosen.measurement;
  if (!m) return offer.id;
  await seedMeasurement(tx, clock, audit, requestId, offer.id, asExecutor, m, fee);
  if (m.status === "DONE") await seedProject(tx, clock, audit, { requestId, offerId: offer.id, asExecutor, o, m });
  return offer.id;
}

/** Раунды торга (решение 2.2.3) — как их пишет requests.proposePrice: прежнее SUPERSEDED, новое PROPOSED. */
async function seedRounds(
  tx: Tx,
  clock: Clock,
  audit: AuditLog,
  p: { offerId: string; scope: string; clientId: string; executorUserId: string; priceTiyn: bigint; sentAt: Date; rounds: OfferSpec["rounds"] & {} },
) {
  const chain: { party: SignParty; authorId: string; amountTiyn: bigint; at: Date }[] = [
    { party: "EXECUTOR", authorId: p.executorUserId, amountTiyn: p.priceTiyn, at: p.sentAt },
    ...p.rounds.map((r) => ({
      party: (r.by === "client" ? "CLIENT" : "EXECUTOR") as SignParty,
      authorId: r.by === "client" ? p.clientId : p.executorUserId,
      amountTiyn: kztToTiyn(r.priceKzt),
      at: clock.ago(r.daysAgo),
    })),
  ];
  for (const [i, step] of chain.entries()) {
    const next = chain[i + 1];
    if (next && next.party === step.party) throw new Error(`Торг отклика ${p.offerId}: сторона не перебивает своё предложение`);
    const status: ProposalStatus = next ? "SUPERSEDED" : "PROPOSED";
    const created = await tx.priceProposal.create({
      data: { offerId: p.offerId, authorId: step.authorId, party: step.party, amountTiyn: step.amountTiyn, status, createdAt: step.at, decidedAt: next?.at ?? null, decidedById: next?.authorId ?? null },
    });
    if (i === 0) continue;
    audit.add(step.at, { id: step.authorId, role: step.party === "CLIENT" ? "CLIENT" : "EXECUTOR" }, "price.proposed", { type: "priceProposal", id: created.id }, p.scope, {
      after: { status: "PROPOSED", party: step.party, amountTiyn: String(step.amountTiyn) },
      meta: { offerId: p.offerId },
    });
  }
}

/** Проект после замера (сценарий 1, ADR-005): ждёт решения заказчика. */
async function seedProject(
  tx: Tx,
  clock: Clock,
  audit: AuditLog,
  p: { requestId: string; offerId: string; asExecutor: AuditActor; o: OfferSpec; m: { visitDaysAgo: number; finalPrice: number } },
) {
  const at = clock.ago(Math.max(p.m.visitDaysAgo - 0.1, 0));
  const project = await tx.project.create({
    data: {
      requestId: p.requestId,
      offerId: p.offerId,
      version: 1,
      status: "SUBMITTED",
      materials: PROJECT_MATERIALS,
      costLines: [
        { title: "Материалы и фурнитура", amount: Math.round(p.m.finalPrice * 0.6) },
        { title: "Изготовление, доставка и монтаж", amount: p.m.finalPrice - Math.round(p.m.finalPrice * 0.6) },
      ],
      durationDays: p.o.durationDays,
      warrantyMonths: p.o.warrantyMonths,
      totalPrice: p.m.finalPrice,
      createdAt: at,
    },
  });
  audit.add(at, p.asExecutor, "project.submitted", { type: "project", id: project.id }, `request:${p.requestId}`, { after: { status: "SUBMITTED", version: 1, totalPrice: p.m.finalPrice } });
}

async function seedMeasurement(tx: Tx, clock: Clock, audit: AuditLog, requestId: string, offerId: string, asExecutor: AuditActor, m: MeasurementSpec, fee: number | null) {
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

// ─── ссылки уведомлений ──────────────────────────────────────────────────────

function resolvePerson(ids: Ids, p: PersonRef): string {
  if ("client" in p) return ids.clients.get(p.client)!;
  if ("executor" in p) return ids.executors.get(p.executor)!.userId;
  return ids.operator;
}

function resolveLink(ids: Ids, link: LinkRef): string {
  if (link.to === "operatorExecutor") return `/operator/executors/${ids.executors.get(link.executor)!.profileId}`;
  const ref = ids.requests.get(link.request);
  if (!ref) throw new Error(`Нет заявки ${link.request} для ссылки уведомления`);
  return link.to === "request" ? `/requests/${ref.id}` : `/executor/requests/${ref.id}`;
}
