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
  type User,
} from "@/gen/senim/identity/v1/identity_pb";
import type { KycStatus, LegalForm, Role } from "@/generated/prisma/enums";
import type { Tx } from "@/platform/db";
import { rpcErrorCode, rpcStatusName } from "@/platform/rpc";
import { legalFormToProto, partyColumns, projectPerson, roleToProto, type PartyColumns } from "./projection";
import { identity } from "./remote";

/**
 * Сид стенда в identity (только APP_ENV не prod у identity — standGate): люди (SeedUsers), согласия на передачу банку
 * (SeedConsents) и сброс одноразового состояния (ResetStand). Вызывается только сидом из терминала, не из интерфейса.
 * Засеянные люди входят как все: телефон и код (на стенде SMS — мок), оператор — со вторым фактором.
 */

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
 * Человек сида стенда: identity создаёт его или обновляет по телефону (SeedUsers), id не меняется; каждый помечается
 * засеянным (seeded), телефон настоящего человека — отказ всей пачки. ФИО, ИИН, e-mail, сторона и согласие на ПДн — в
 * identity: договор, подпись ЭЦП и выплата берут их оттуда (RevealPartyDetails, VerifySignerIin), а экран согласия не
 * показывается тому, у кого засеяно согласие текущей редакции. `totpSecretBase32` — известный секрет TOTP оператора
 * стенда (base32 без «=», 16–64 байт): вход оператора требует код по нему (e2e — `e2e/totp.ts`).
 */
export type SeedPerson = {
  phone: string;
  role: Role;
  roles: Role[];
  createdAt: Date;
  fullName?: string;
  iin?: string;
  email?: string;
  party?: SeedPartyInput;
  consent?: SeedConsentProof;
  totpSecretBase32?: string;
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
    if (code) throw new Error(`identity отказал в ${method}: ${code}${code === "stand_disabled" ? " (сид разрешён только при APP_ENV dev или staging у identity)" : ""}`, { cause: e });
    const reason = e instanceof ConnectError ? rpcStatusName(e) : e instanceof Error ? e.message : String(e);
    throw new Error(`identity недоступен (${method}: ${reason}): ${STAND_HINT}`, { cause: e });
  }
}

/**
 * Люди сида — в identity (SeedUsers, только вне prod у identity): возвращает пользователей в порядке `people`;
 * их id — id старой базы (проекция — projectUser в транзакции сида).
 */
export async function seedIdentityUsers(people: SeedPerson[]): Promise<User[]> {
  const res = await seedCall("SeedUsers", () =>
    identity().seedUsers({
      users: people.map((p) => ({
        phone: p.phone,
        defaultRole: roleToProto(p.role),
        roles: p.roles.map(roleToProto),
        createdAt: timestampFromDate(p.createdAt),
        fullName: p.fullName ?? "",
        iin: p.iin ?? "",
        email: p.email ?? "",
        party: p.party ? seedParty(p.party) : undefined,
        consentVersion: p.consent?.version ?? "",
        consentTextSha256: p.consent?.textSha256 ?? "",
        totpSecretBase32: p.totpSecretBase32 ?? "",
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
 * последние 4 цифры ИИН и e-mail. Адрес сида identity записывает подтверждённым (человек стенда не проходит шаг почты),
 * поэтому и в проекции он подтверждён. Сам ИИН в старую базу не попадает.
 */
export async function projectSeedPerson(userId: string, p: SeedPerson, tx: Tx): Promise<void> {
  const email = p.email ?? "";
  await projectPerson(create(PersonSchema, { userId, fullName: p.fullName ?? "", iinLast4: last4(p.iin), email, emailVerified: email !== "" }), tx);
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

/** Согласие на передачу банку к сделке сида (SeedConsents, канал seed): сторона сделки сида, оплачиваемой без входа. */
export type SeedBankConsent = SeedConsentProof & { userId: string; dealId: string };

/**
 * Согласия на передачу банку сделок сида — в identity (SeedConsents, только вне prod у identity): сид оплачивает сделки
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

/**
 * Сброс стенда в identity (ResetStand, только вне prod у identity): сессии, коды, лимиты, вторые факторы и согласия
 * засеянных, сохранённые ответы удаляются; пользователи остаются. Только сид из терминала.
 */
export async function resetStand(): Promise<void> {
  await seedCall("ResetStand", () => identity().resetStand({ idempotencyKey: randomUUID() }));
}
