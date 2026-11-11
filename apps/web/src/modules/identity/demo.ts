import "server-only";
import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import {
  ConsentKind as ProtoConsentKind,
  KycStatus as ProtoKycStatus,
  PartySchema,
  PersonSchema,
  Role as ProtoRole,
  type User,
} from "@/gen/senim/identity/v1/identity_pb";
import type { KycStatus, LegalForm, Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { rpcErrorCode, rpcStatusName } from "@/platform/rpc";
import { legalFormToProto, partyColumns, projectPerson, roleFromProto, roleToProto, type PartyColumns } from "./projection";
import { identity } from "./remote";
import { identityFailure } from "./remote-errors";
import { newSessionToken } from "./session-cookie";
import { beginSession, currentToken, signOutPrevious } from "./session";

/**
 * Демо-персоны: вход одним нажатием, только при DEMO_MODE=true и только пользователем с isDemo.
 * В MVP switchUser ставил cookie с любым id — здесь режим и isDemo проверяет identity (StartDemoSession),
 * а токен сессии создаёт web: без доверия к данным клиента.
 */

export type DemoPersona = {
  id: string;
  /** Роль по умолчанию: в ней персона входит и по ней группируется на /demo. */
  role: Role;
  /** Выданные роли (ADR-004): у персоны с двумя ролями в шапке есть переключатель. */
  roles: Role[];
  fullName: string | null;
  phone: string;
  executor: { publicNumber: number; legalForm: LegalForm; legalName: string; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

const ROLE_ORDER: Record<Role, number> = { OPERATOR: 0, MEASURER: 1, CLIENT: 2, EXECUTOR: 3 };

export async function listDemoPersonas(): Promise<DemoPersona[]> {
  if (!env().DEMO_MODE) return [];
  const users = await db.user.findMany({
    where: { isDemo: true, blockedAt: null },
    select: {
      id: true,
      role: true,
      roles: true,
      fullName: true,
      phone: true,
      executorProfile: { select: { publicNumber: true, legalForm: true, legalName: true, status: true } },
    },
    orderBy: { phone: "asc" },
  });
  return users
    .map(({ executorProfile, ...u }) => ({ ...u, executor: executorProfile }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (a.executor?.publicNumber ?? 0) - (b.executor?.publicNumber ?? 0));
}

/**
 * KYC стороны сида — как после подачи и решения оператора: файлы (id StoredFile, UUID) по видам; причина — только у
 * REJECTED; reviewedAt — дата решения из истории сида (в identity не передаётся: там время решения — момент сида).
 * null — документы не подавались (NOT_SUBMITTED).
 */
export type SeedKyc = { status: KycStatus; idFileIds: string[]; registrationFileIds: string[]; rejectReason: string | null; reviewedAt: Date | null };

/**
 * Сторона исполнителя сида (SeedParty): binIin null — ИП и самозанятый работают по ИИН личности; signerIin — директор ТОО;
 * payoutIban null — счёт не указан.
 */
export type SeedPartyInput = {
  legalForm: LegalForm;
  legalName: string;
  binIin: string | null;
  signerFullName: string;
  signerIin: string | null;
  payoutIban: string | null;
  kyc: SeedKyc | null;
};

/** Согласие сида (на ПДн у SeedUser, передача банку — SeedConsent): версия и SHA-256 текста, который видит человек. */
export type SeedConsentProof = { version: string; textSha256: string };

/**
 * Человек сида демо-стенда: identity создаёт его или обновляет по телефону (SeedUsers), id не меняется. ФИО, ИИН, e-mail,
 * сторона и согласие на ПДн — в identity: договор, подпись ЭЦП и выплата берут их оттуда (RevealPartyDetails,
 * VerifySignerIin), а экран согласия не показывается тому, у кого засеяно согласие текущей редакции.
 */
export type SeedPerson = {
  phone: string;
  role: Role;
  roles: Role[];
  isDemo: boolean;
  createdAt: Date;
  fullName?: string;
  iin?: string;
  email?: string;
  party?: SeedPartyInput;
  consent?: SeedConsentProof;
};

const KYC_TO_PROTO: Record<KycStatus, ProtoKycStatus> = {
  PENDING: ProtoKycStatus.PENDING,
  VERIFIED: ProtoKycStatus.VERIFIED,
  REJECTED: ProtoKycStatus.REJECTED,
};

const seedParty = (p: SeedPartyInput) => ({
  legalForm: legalFormToProto(p.legalForm),
  legalName: p.legalName,
  binIin: p.binIin ?? "",
  signerFullName: p.signerFullName,
  signerIin: p.signerIin ?? "",
  payoutIban: p.payoutIban ?? "",
  kycStatus: p.kyc ? KYC_TO_PROTO[p.kyc.status] : ProtoKycStatus.NOT_SUBMITTED,
  kycIdFileIds: p.kyc?.idFileIds ?? [],
  kycRegistrationFileIds: p.kyc?.registrationFileIds ?? [],
  kycRejectReason: p.kyc?.rejectReason ?? "",
});

const STAND_HINT = "запустите стенд v2 (npm run v2:up) и задайте V2_ENABLED и MESH_* (пример — apps/web/e2e/v2.vars.example)";

/** Вызов identity из сида: недоступный сервис — ошибка с подсказкой, отказ — с кодом identity. Тексты — для разработчика, не для экрана. */
async function seedCall<T>(method: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const code = rpcErrorCode(e);
    if (code) throw new Error(`identity отказал в ${method}: ${code}${code === "demo_disabled" ? " (сиду нужен DEMO_MODE=true у identity)" : ""}`, { cause: e });
    const reason = e instanceof ConnectError ? rpcStatusName(e) : e instanceof Error ? e.message : String(e);
    throw new Error(`identity недоступен (${method}: ${reason}): ${STAND_HINT}`, { cause: e });
  }
}

/**
 * Люди сида — в identity (SeedUsers, только DEMO_MODE у identity): возвращает пользователей в порядке `people`;
 * их id — id старой базы (проекция — projectUser в транзакции сида).
 */
export async function seedIdentityUsers(people: SeedPerson[]): Promise<User[]> {
  const res = await seedCall("SeedUsers", () =>
    identity().seedUsers({
      users: people.map((p) => ({
        phone: p.phone,
        defaultRole: roleToProto(p.role),
        roles: p.roles.map(roleToProto),
        isDemo: p.isDemo,
        createdAt: timestampFromDate(p.createdAt),
        fullName: p.fullName ?? "",
        iin: p.iin ?? "",
        email: p.email ?? "",
        party: p.party ? seedParty(p.party) : undefined,
        consentVersion: p.consent?.version ?? "",
        consentTextSha256: p.consent?.textSha256 ?? "",
      })),
      idempotencyKey: randomUUID(),
    }),
  );
  if (res.users.length !== people.length || res.users.some((u, i) => u.phone !== people[i]!.phone)) throw new Error("identity вернул пользователей сида не в порядке запроса");
  return res.users;
}

const last4 = (v: string | null | undefined) => (v ? v.slice(-4) : "");

/**
 * Проекция личности человека сида в старую `User` (projectPerson) — какой её вернул бы identity после SeedUsers: ФИО,
 * последние 4 цифры ИИН и e-mail. Сам ИИН в старую базу не попадает.
 */
export async function projectSeedPerson(userId: string, p: SeedPerson, tx: Tx): Promise<void> {
  await projectPerson(create(PersonSchema, { userId, fullName: p.fullName ?? "", iinLast4: last4(p.iin), email: p.email ?? "" }), tx);
}

/**
 * Столбцы профиля исполнителя сида — проекция стороны (partyColumns), какой её вернул бы identity после SeedUsers: форма,
 * наименование, последние 4 символа ИИН/БИН (у ИП и самозанятого — ИИН личности) и IBAN, подписант, KYC. Ни шифртекстов,
 * ни HMAC.
 */
export function seedPartyColumns(userId: string, p: SeedPerson & { party: SeedPartyInput }): PartyColumns {
  const { party } = p;
  return partyColumns(
    create(PartySchema, {
      userId,
      legalForm: legalFormToProto(party.legalForm),
      legalName: party.legalName,
      binIinLast4: last4(party.binIin ?? p.iin),
      signerFullName: party.signerFullName,
      signerIinLast4: last4(party.signerIin),
      payoutIbanLast4: last4(party.payoutIban),
      kycStatus: party.kyc ? KYC_TO_PROTO[party.kyc.status] : ProtoKycStatus.NOT_SUBMITTED,
      kycRejectReason: party.kyc?.rejectReason ?? "",
      kycReviewedAt: party.kyc?.reviewedAt ? timestampFromDate(party.kyc.reviewedAt) : undefined,
      kycIdFileIds: party.kyc?.idFileIds ?? [],
      kycRegistrationFileIds: party.kyc?.registrationFileIds ?? [],
    }),
  );
}

/** Согласие на передачу банку к сделке сида (SeedConsents, канал seed): сторона демо-сделки, оплачиваемой без входа. */
export type SeedBankConsent = SeedConsentProof & { userId: string; dealId: string };

/**
 * Согласия на передачу банку демо-сделок — в identity (SeedConsents, только DEMO_MODE у identity): сид оплачивает сделки
 * без сессий сторон, а оплата проверяет согласия обеих сторон (payForDeal, HasConsents) как у всех.
 */
export async function seedIdentityBankConsents(consents: SeedBankConsent[]): Promise<void> {
  if (consents.length === 0) return;
  await seedCall("SeedConsents", () =>
    identity().seedConsents({
      consents: consents.map((c) => ({ userId: c.userId, kind: ProtoConsentKind.BANK_TRANSFER, version: c.version, textSha256: c.textSha256, referenceId: c.dealId })),
      idempotencyKey: randomUUID(),
    }),
  );
}

/** «Сбросить демо» в identity: сессии, коды, лимиты и сохранённые ответы удаляются, пользователи остаются. */
export async function resetIdentityDemo(): Promise<void> {
  await seedCall("ResetDemo", () => identity().resetDemo({ idempotencyKey: randomUUID() }));
}

/**
 * Вход персоной (asRole — в указанной выданной роли): сессию начинает identity (StartDemoSession), web даёт токен;
 * возвращает роль сессии и статус профиля исполнителя — чтобы выбрать экран после входа.
 */
export async function loginAsDemoPersona(
  userId: string,
  userAgent?: string,
  asRole?: Role,
): Promise<Pick<DemoPersona, "id" | "role"> & { executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null }> {
  if (!env().DEMO_MODE) return fail.forbidden(ru.identity.demo.disabled);
  const previous = await currentToken();

  const token = newSessionToken();
  let res;
  try {
    res = await identity().startDemoSession({
      userId,
      asRole: asRole ? roleToProto(asRole) : ProtoRole.UNSPECIFIED,
      sessionToken: token,
      userAgent: (userAgent ?? "").slice(0, 300),
      idempotencyKey: randomUUID(),
    });
  } catch (e) {
    return identityFailure(e);
  }
  const { user, session } = await beginSession(token, res);
  // Только после успешного входа: отказ (роль не выдана, нет персоны) старую сессию не трогает.
  await signOutPrevious(previous);

  const profile = await db.executorProfile.findUnique({ where: { userId: user.id }, select: { status: true } });
  return { id: user.id, role: roleFromProto(session.activeRole), executor: profile };
}
