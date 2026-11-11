import "server-only";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  KycStatus as ProtoKycStatus,
  LegalForm as ProtoLegalForm,
  Role as ProtoRole,
  type Party,
  type Person,
  type User,
} from "@/gen/senim/identity/v1/identity_pb";
import type { KycStatus, LegalForm, Role as PrismaRole } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";

const TO_PRISMA = {
  [ProtoRole.CLIENT]: "CLIENT",
  [ProtoRole.EXECUTOR]: "EXECUTOR",
  [ProtoRole.OPERATOR]: "OPERATOR",
  [ProtoRole.MEASURER]: "MEASURER",
} as const satisfies Partial<Record<ProtoRole, PrismaRole>>;

const TO_PROTO: Record<PrismaRole, ProtoRole> = {
  CLIENT: ProtoRole.CLIENT,
  EXECUTOR: ProtoRole.EXECUTOR,
  OPERATOR: ProtoRole.OPERATOR,
  MEASURER: ProtoRole.MEASURER,
};

/** Роль из identity → роль старой базы. `ROLE_UNSPECIFIED` — ошибка контракта. */
export function roleFromProto(r: ProtoRole): PrismaRole {
  const role = (TO_PRISMA as Partial<Record<ProtoRole, PrismaRole>>)[r];
  if (!role) throw new Error(`identity вернул неизвестную роль: ${r}`);
  return role;
}

export function roleToProto(r: PrismaRole): ProtoRole {
  return TO_PROTO[r];
}

const sameRoles = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/**
 * Проекция пользователя identity в старую таблицу `User` (тот же `id`): на неё ссылаются сделки, заявки и профили.
 * Пишутся только поля пользователя identity: телефон, роль по умолчанию, роли, демо-флаг, блокировка; личность
 * (ФИО, ИИН, контакты) — projectPerson. Обновляются только изменившиеся поля. Строка с тем же телефоном, но другим `id`
 * (dev-база до перехода на identity) — ошибка с записью в лог, а не дубль.
 * `client` — транзакция сида демо (пользователи появляются вместе с остальными данными); по умолчанию — `db`.
 */
export async function projectUser(user: User, client: Tx = db): Promise<void> {
  try {
    await project(user, client);
  } catch (e) {
    // Два параллельных запроса создали одного пользователя: проигравший повторяет, видит строку и сверяет поля.
    // В транзакции повтор невозможен (она прервана ошибкой) — ошибка уходит наверх.
    if (!isUniqueViolation(e) || client !== db) throw e;
    await project(user, client);
  }
}

async function project(user: User, client: Tx): Promise<void> {
  const role = roleFromProto(user.defaultRole);
  const roles = user.roles.map(roleFromProto);
  if (!roles.includes(role)) throw new Error("identity вернул роль по умолчанию вне выданных ролей");
  const blockedAt = user.blockedAt ? timestampDate(user.blockedAt) : null;

  const phoneOwner = await client.user.findUnique({ where: { phone: user.phone }, select: { id: true } });
  if (phoneOwner && phoneOwner.id !== user.id) {
    logger.error("identity.projection.phone_conflict", { userId: user.id });
    return fail.conflict();
  }

  const row = await client.user.findUnique({ where: { id: user.id }, select: { phone: true, role: true, roles: true, isDemo: true, blockedAt: true } });
  if (!row) {
    await client.user.create({ data: { id: user.id, phone: user.phone, role, roles, isDemo: user.isDemo, blockedAt } });
    return;
  }

  const data = {
    ...(row.phone !== user.phone && { phone: user.phone }),
    ...(row.role !== role && { role }),
    ...(!sameRoles(row.roles, roles) && { roles }),
    ...(row.isDemo !== user.isDemo && { isDemo: user.isDemo }),
    ...((row.blockedAt?.getTime() ?? null) !== (blockedAt?.getTime() ?? null) && { blockedAt }),
  };
  if (Object.keys(data).length > 0) await client.user.update({ where: { id: user.id }, data });
}

/** Пусто в ответе identity — поле не указано: в старой базе это null. */
const orNull = (v: string): string | null => (v === "" ? null : v);

/**
 * Проекция личности identity в старую `User`: ФИО, последние 4 цифры ИИН, Instagram и e-mail — их показывают экраны
 * и сверяют страницы (needsIntroduction, hasClientIdentity). Пишутся только изменившиеся поля. Сам ИИН в старой базе
 * больше не хранится: `iinEnc` и `iinHash` не пишутся (ИИН — только в identity, шифртекстом). Строка пользователя уже
 * есть (projectUser при входе); её нет — сбой.
 */
export async function projectPerson(person: Person, client: Tx = db): Promise<void> {
  const row = await client.user.findUnique({ where: { id: person.userId }, select: { fullName: true, iinLast4: true, instagram: true, email: true } });
  if (!row) throw new Error("identity вернул личность пользователя, которого нет в проекции");
  const next = { fullName: orNull(person.fullName), iinLast4: orNull(person.iinLast4), instagram: orNull(person.instagram), email: orNull(person.email) };
  const data = {
    ...(row.fullName !== next.fullName && { fullName: next.fullName }),
    ...(row.iinLast4 !== next.iinLast4 && { iinLast4: next.iinLast4 }),
    ...(row.instagram !== next.instagram && { instagram: next.instagram }),
    ...(row.email !== next.email && { email: next.email }),
  };
  if (Object.keys(data).length > 0) await client.user.update({ where: { id: person.userId }, data });
}

/**
 * Личность из ответа identity на вызов в сессии пользователя `userId`. Нет её или она чужая — сбой контракта: в лог
 * (без значений), человеку — общий текст. Чужие ФИО и контакты в проекцию не попадают.
 */
export function ownPerson(userId: string, person: Person | undefined): Person {
  if (person?.userId === userId) return person;
  logger.error("identity.call_rejected", { reason: person ? "person_of_other_user" : "response_without_person" });
  return fail.unavailable(ru.common.errors.generic);
}

const LEGAL_FORM_FROM_PROTO = {
  [ProtoLegalForm.SELF_EMPLOYED]: "SELF_EMPLOYED",
  [ProtoLegalForm.IP]: "IP",
  [ProtoLegalForm.TOO]: "TOO",
} as const satisfies Partial<Record<ProtoLegalForm, LegalForm>>;

const LEGAL_FORM_TO_PROTO: Record<LegalForm, ProtoLegalForm> = {
  SELF_EMPLOYED: ProtoLegalForm.SELF_EMPLOYED,
  IP: ProtoLegalForm.IP,
  TOO: ProtoLegalForm.TOO,
};

/**
 * KYC identity → KYC старой базы. В Prisma нет NOT_SUBMITTED, поэтому «не подано» и «на проверке» — оба PENDING.
 * Источник правды — identity: экраны KYC (getOwnKyc, kycQueue) берут состояние из ответа identity, а не из этого столбца.
 */
const KYC_FROM_PROTO = {
  [ProtoKycStatus.NOT_SUBMITTED]: "PENDING",
  [ProtoKycStatus.PENDING]: "PENDING",
  [ProtoKycStatus.VERIFIED]: "VERIFIED",
  [ProtoKycStatus.REJECTED]: "REJECTED",
} as const satisfies Partial<Record<ProtoKycStatus, KycStatus>>;

export function legalFormToProto(f: LegalForm): ProtoLegalForm {
  return LEGAL_FORM_TO_PROTO[f];
}

/** Правовая форма из ответа identity; UNSPECIFIED и неизвестное — ошибка контракта. */
export function legalFormFromProto(f: ProtoLegalForm): LegalForm {
  return fromProto<ProtoLegalForm, LegalForm>(LEGAL_FORM_FROM_PROTO, f, "правовой формы");
}

/** Значение перечисления из ответа identity; UNSPECIFIED и неизвестное — ошибка контракта. */
function fromProto<K extends number, V>(table: Partial<Record<K, V>>, value: K, what: string): V {
  const mapped = table[value];
  if (mapped === undefined) throw new Error(`identity вернул неизвестное значение ${what}: ${value}`);
  return mapped;
}

/**
 * Столбцы профиля исполнителя из стороны identity: форма, наименование, последние 4 цифры ИИН/БИН, подписант, последние
 * 4 символа IBAN и KYC. Ни шифртекстов, ни HMAC: ИИН/БИН, ИИН подписанта и IBAN хранит только identity.
 */
export function partyColumns(party: Party) {
  return {
    legalForm: fromProto<ProtoLegalForm, LegalForm>(LEGAL_FORM_FROM_PROTO, party.legalForm, "правовой формы"),
    legalName: party.legalName,
    binIinLast4: party.binIinLast4,
    signerFullName: orNull(party.signerFullName),
    payoutIbanLast4: orNull(party.payoutIbanLast4),
    kycStatus: fromProto<ProtoKycStatus, KycStatus>(KYC_FROM_PROTO, party.kycStatus, "статуса KYC"),
    kycRejectReason: orNull(party.kycRejectReason),
    kycReviewedAt: party.kycReviewedAt ? timestampDate(party.kycReviewedAt) : null,
  };
}

export type PartyColumns = ReturnType<typeof partyColumns>;

/**
 * Проекция стороны identity в профиль исполнителя (`ExecutorProfile` пользователя): только изменившиеся поля из
 * partyColumns. Профиль уже есть (его создаёт регистрация или «Добавить исполнителя» с теми же столбцами); нет — сбой.
 */
export async function projectParty(party: Party, client: Tx = db): Promise<void> {
  const row = await client.executorProfile.findUnique({
    where: { userId: party.userId },
    select: { legalForm: true, legalName: true, binIinLast4: true, signerFullName: true, payoutIbanLast4: true, kycStatus: true, kycRejectReason: true, kycReviewedAt: true },
  });
  if (!row) throw new Error("identity вернул сторону пользователя без профиля исполнителя в проекции");
  const next = partyColumns(party);
  const data = Object.fromEntries(
    (Object.keys(next) as (keyof PartyColumns)[]).filter((k) => !sameValue(row[k], next[k])).map((k) => [k, next[k]]),
  ) as Partial<PartyColumns>;
  if (Object.keys(data).length > 0) await client.executorProfile.update({ where: { userId: party.userId }, data });
}

const sameValue = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

/**
 * Сторона из ответа identity на вызов о пользователе `userId`. Нет её или она чужая — сбой контракта: в лог (без
 * значений), человеку — общий текст. Чужие реквизиты в проекцию не попадают.
 */
export function ownParty(userId: string, party: Party | undefined): Party {
  if (party?.userId === userId) return party;
  logger.error("identity.call_rejected", { reason: party ? "party_of_other_user" : "response_without_party" });
  return fail.unavailable(ru.common.errors.generic);
}
