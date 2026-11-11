import { clone, create, toBinary, type DescMessage, type MessageInitShape } from "@bufbuild/protobuf";
import { TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type Client } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import {
  AuthenticateRequestSchema,
  AuthenticateResponseSchema,
  ConfirmTotpEnrollmentRequestSchema,
  ConfirmTotpEnrollmentResponseSchema,
  ConsentKind,
  ConsentRevocationSchema,
  ConsentSchema,
  GetProfileRequestSchema,
  GetProfileResponseSchema,
  GrantConsentRequestSchema,
  GrantConsentResponseSchema,
  GrantRoleRequestSchema,
  HasConsentsRequestSchema,
  HasConsentsResponseSchema,
  IdentityService,
  GrantRoleResponseSchema,
  KycStatus,
  LegalForm,
  ListConsentRevocationsRequestSchema,
  ListConsentRevocationsResponseSchema,
  ListKycQueueRequestSchema,
  ListKycQueueResponseSchema,
  ListMyConsentsRequestSchema,
  ListMyConsentsResponseSchema,
  PartyDetailsSchema,
  PartySchema,
  PersonSchema,
  ProvisionExecutorRequestSchema,
  ProvisionExecutorResponseSchema,
  RecordPersonRequestSchema,
  RecordPersonResponseSchema,
  RegisterPartyRequestSchema,
  RegisterPartyResponseSchema,
  RequestOtpRequestSchema,
  RequestOtpResponseSchema,
  ResetDemoRequestSchema,
  ResetDemoResponseSchema,
  ResolveConsentRevocationRequestSchema,
  ResolveConsentRevocationResponseSchema,
  RevealPartyDetailsRequestSchema,
  RevealPartyDetailsResponseSchema,
  RevealPurpose,
  ReviewKycRequestSchema,
  ReviewKycResponseSchema,
  RevocationStatus,
  RevokeConsentRequestSchema,
  RevokeConsentResponseSchema,
  Role,
  SeedConsentsRequestSchema,
  SeedConsentsResponseSchema,
  SeedUsersRequestSchema,
  SeedUsersResponseSchema,
  SessionSchema,
  SetPayoutIbanRequestSchema,
  SetPayoutIbanResponseSchema,
  SignOutEverywhereRequestSchema,
  SignOutEverywhereResponseSchema,
  SignOutRequestSchema,
  SignOutResponseSchema,
  SigningSide,
  StartDemoSessionRequestSchema,
  StartDemoSessionResponseSchema,
  StartTotpEnrollmentRequestSchema,
  StartTotpEnrollmentResponseSchema,
  SubmitKycRequestSchema,
  SubmitKycResponseSchema,
  SwitchRoleRequestSchema,
  SwitchRoleResponseSchema,
  UpdateContactsRequestSchema,
  UpdateContactsResponseSchema,
  UserSchema,
  VerifyOtpRequestSchema,
  VerifyOtpResponseSchema,
  VerifySecondFactorRequestSchema,
  VerifySecondFactorResponseSchema,
  VerifySignerIinRequestSchema,
  VerifySignerIinResponseSchema,
  type Consent,
  type ConsentRevocation,
  type Party,
  type PartyDetails,
  type Person,
  type Session,
  type User,
} from "@/gen/senim/identity/v1/identity_pb";
import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { toBase32, totpCode, totpStep } from "../../e2e/totp";
// Прямой импорт файла, а не index.ts: index тянет next/headers, и подделка (она грузится в setup до vi.mock) закрепила бы настоящий модуль.
// eslint-disable-next-line no-restricted-imports
import { TOKEN_SHAPE } from "@/modules/identity/session-cookie";
// Те же проверки форматов, что перенесены в Go (kzid.go): ФИО, ИИН, Instagram.
// eslint-disable-next-line no-restricted-imports
import { isValidFullName, normalizeFullName } from "@/modules/identity/full-name";
// eslint-disable-next-line no-restricted-imports
import { INSTAGRAM_MAX } from "@/modules/identity/instagram";
// eslint-disable-next-line no-restricted-imports
import { isValidBin, isValidIin } from "@/modules/identity/kz-id";
// Тот же разбор IBAN, что в Go (party.go, parseKzIban).
// eslint-disable-next-line no-restricted-imports
import { parseKzIban } from "@/modules/identity/iban";
// Текущая редакция согласия на ПДн: пользователи тестов по умолчанию уже дали его (как демо-персоны после сида).
// eslint-disable-next-line no-restricted-imports
import { consentDocument, consentTextSha256 } from "@/modules/identity/consent-text";

/**
 * Подделка identity для тестов web: пользователи и сессии в памяти, семантика по контракту
 * (proto/senim/identity/v1/identity.proto). Не повторяет лимиты и сроки настоящего сервиса:
 * их проверяют тесты Go. `id` пользователя — `u-<цифры телефона>`.
 *
 * Сознательные расхождения с Go (тестам web они не мешают):
 * - `PHONE_RE` шире: любой `+7` и 10 цифр; Go (phone.go) принимает только `+77…`;
 * - `sessionView` всегда даёт 7 суток; в Go у сотрудника (OPERATOR, MEASURER) — 8 ч;
 * - `signOutEverywhere` для заблокированного — no-op (lookup отказывает); Go отзывает его сессии
 *   (sessionByToken без проверки блокировки).
 *
 * Второй фактор (TOTP, mfa.go) повторён по Go: порядок проверок и коды, лимит 5 неверных кодов (и повторов) за
 * 15 минут фиксированным окном (верный код попытку возвращает), шаг принятого кода не принимается дважды, повтор
 * Start по ключу после замены секрета — idempotency_key_reused, демо-оператор входит с пройденной второй ступенью,
 * ResetDemo стирает факторы. Часы — `now` (тест может подменить). Вход в обход кода (`signIn`) у оператора — уже
 * с пройденной второй ступенью («вошедший пользователь»), если тест не передал `mfaVerifiedAt: null`.
 *
 * Личность и контакты (person.go) повторены по Go: порядок проверок и коды (формат до лимита попыток, лимит 5 попыток
 * указать ИИН в час фиксированным окном, тот же ИИН ещё раз — тот же ответ без попытки, другой поверх записанного —
 * person_already_recorded, чужой — iin_taken; UpdateContacts — полное новое состояние, только активной роли CLIENT или
 * EXECUTOR). ИИН хранится открыто (в Go — шифртекст и HMAC); события аудита — в `auditEvents`, без значений.
 *
 * Реквизиты исполнителя (party.go) повторены по Go: RegisterParty, ProvisionExecutor и SetPayoutIban — порядок проверок
 * (ключ, формат, сессия и роль; дальше повтор по ключу и «транзакция») и коды. ИП и самозанятый в RegisterParty работают
 * по ИИН личности (person_missing, если его нет); те же реквизиты ещё раз — тот же ответ; другие поверх записанных
 * RegisterParty перезаписывает, пока KYC не подана или отклонена (иначе и в ProvisionExecutor — party_exists); ИИН/БИН
 * другой стороны — iin_taken; новая сторона — KYC NOT_SUBMITTED; SetPayoutIban отвечает changed. Номера хранятся открыто.
 *
 * Раскрытие и сверка (reveal.go, VerifySignerIin в party.go): RevealPartyDetails — порядок проверок (цель —
 * reveal_purpose_invalid, ссылка 1..128 и список 1..50 — invalid_request, затем сессия действующего лица; оператор без второй
 * ступени — mfa_required), повторы убираются, неизвестный пропускается, аудит pii.revealed на каждого субъекта — без значений
 * (действующее лицо без сессии — сервис, `actorRole` UNSPECIFIED). VerifySignerIin — сторона обязательна (invalid_request),
 * не ИИН — не совпало, заказчик — ИИН личности, исполнитель — директор ТОО или ИИН стороны ИП и самозанятого, без стороны —
 * не совпало. Расхождение с Go: id пользователей не проверяются как UUID (id подделки — `u-<цифры>` и cuid фабрик).
 * SeedUsers пишет личность (заданные поля) и сторону целиком (seedPerson и seedPartyRow) с теми же проверками.
 *
 * KYC исполнителя (kyc.go, kyc_policy.go) повторён по Go: порядок проверок и коды, таблица переходов (подача из NOT_SUBMITTED,
 * PENDING — файлы заменяются — и REJECTED; решение — только из PENDING), условный переход (второе решение и решение по
 * подаче, заменённой после открытия очереди, — kyc_transition_forbidden), очередь — PENDING с обоими видами файлов, давно ждущие первыми. Аудит executor.kyc_* — в
 * `auditEvents`, без значений. Расхождение с Go: ReviewKyc не проверяет user_id как UUID (как и прочие методы подделки);
 * идентификаторы файлов — проверяет (их задаёт web).
 *
 * Согласия (consent.go) повторены по Go: GrantConsent — порядок проверок (ключ, вид — invalid_request, версия и SHA-256 —
 * consent_version_invalid, предмет по виду и цели — invalid_request, сессия), действующее той же версии и предмета — та же
 * запись, другой хэш — consent_version_invalid; RevokeConsent — только ПДн (consent_not_revocable), нет действующего —
 * consent_missing, открытая заявка — та же, срок — 15 рабочих дней по Алматы (UTC+5, праздники не учитываются, как в Go);
 * согласие остаётся действующим до решения (Ruling P); ResolveConsentRevocation — причина по переходу (invalid_request),
 * оператор со второй ступенью (role_forbidden, mfa_required), решённая или неизвестная заявка — revocation_closed,
 * COMPLETED отзывает согласия, данные не позже заявки. Authenticate отдаёт только действующие согласия на ПДн.
 * Пользователь, добавленный тестом (`addUser`), по умолчанию уже дал согласие на ПДн текущей редакции (канал seed) —
 * как демо-персоны после сида; новый пользователь входа по SMS, ProvisionExecutor и SeedUsers без согласия — нет.
 * Расхождение с Go: HasConsents не проверяет id пользователей как UUID (как и прочие методы подделки).
 */

/** Тип клиента — тот же, что у `IdentityClient` из modules/identity/remote (импорт оттуда из test/ запрещён границей модулей). */
type IdentityClient = Client<typeof IdentityService>;

/** Код, который подделка принимает как верный одноразовый код. */
export const FAKE_OTP_CODE = "123456";
const MAX_KEY = 128;
const PHONE_RE = /^\+7\d{10}$/;
const STAFF: readonly Role[] = [Role.OPERATOR, Role.MEASURER];
/** Как mfa.go: неверных кодов не больше 5 за 15 минут; поле code — не длиннее 32 символов до разбора. */
const MFA_MAX_FAILURES = 5;
const MFA_FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_TOTP_CODE_LEN = 32;
/** Как person.go: попыток указать ИИН не больше 5 в час на пользователя. */
const PERSON_MAX_ATTEMPTS = 5;
const PERSON_ATTEMPT_WINDOW_MS = 3600_000;
/** emailField / emailMax в Go: шаблон z.email() и предел длины. */
const EMAIL_MAX = 254;
const INSTAGRAM_RE = /^[A-Za-z0-9._]*$/;

/** Личность в подделке: пустая строка — поле не указано (в Go — NULL). */
type StoredPerson = { fullName: string; iin: string; instagram: string; email: string };

/** Сторона (реквизиты исполнителя) в подделке: номера открыто, пустая строка — не указано. */
type StoredParty = {
  legalForm: LegalForm;
  legalName: string;
  binIin: string;
  signerFullName: string;
  signerIin: string;
  payoutIban: string;
  kycStatus: KycStatus;
  kycRejectReason: string;
  kycSubmittedAt: Date | null;
  kycReviewedAt: Date | null;
  kycIdFileIds: string[];
  kycRegistrationFileIds: string[];
};

/** Поля KYC новой стороны: документы не поданы (массивы — новые у каждой стороны). */
const noKyc = () => ({
  kycStatus: KycStatus.NOT_SUBMITTED,
  kycRejectReason: "",
  kycSubmittedAt: null,
  kycReviewedAt: null,
  kycIdFileIds: [] as string[],
  kycRegistrationFileIds: [] as string[],
});

/** kyc_policy.go: не больше 4 файлов каждого вида; причина отказа — 3–500 символов после обрезки пробелов. */
const KYC_MAX_FILES = 4;
const KYC_REASON_MIN = 3;
const KYC_REASON_MAX = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** kycTransitions в Go: что можно делать с проверкой документов; всего, чего нет в таблице, нельзя. */
const KYC_TRANSITIONS = {
  submit: { from: [KycStatus.NOT_SUBMITTED, KycStatus.PENDING, KycStatus.REJECTED], to: KycStatus.PENDING },
  verify: { from: [KycStatus.PENDING], to: KycStatus.VERIFIED },
  reject: { from: [KycStatus.PENDING], to: KycStatus.REJECTED },
} as const satisfies Record<string, { from: readonly KycStatus[]; to: KycStatus }>;

/** kycFileIDs в Go: не больше 4, каждый — UUID в каноническом виде; повторы убираются (нижний регистр, порядок первого). */
function kycFileIds(raw: readonly string[]): string[] {
  if (raw.length > KYC_MAX_FILES || raw.some((id) => !UUID_RE.test(id))) throw codedError("invalid_request", Code.InvalidArgument);
  return [...new Set(raw.map((id) => id.toLowerCase()))];
}

/** kycTarget в Go (роль проверена раньше): не то состояние — kyc_transition_forbidden, решение без документов — kyc_documents_missing. */
function kycTarget(action: keyof typeof KYC_TRANSITIONS, p: StoredParty): KycStatus {
  const rule = KYC_TRANSITIONS[action];
  if (!(rule.from as readonly KycStatus[]).includes(p.kycStatus)) throw codedError("kyc_transition_forbidden", Code.FailedPrecondition);
  if (action !== "submit" && (p.kycIdFileIds.length === 0 || p.kycRegistrationFileIds.length === 0)) {
    throw codedError("kyc_documents_missing", Code.FailedPrecondition);
  }
  return rule.to;
}

/**
 * expected_submitted_at в Go: обязательно и корректно (CheckValid: 0001–9999 годы, наносекунды 0…999 999 999), иначе
 * invalid_request; сравнивается с точностью базы — до микросекунд (усечение).
 */
function timestampMicros(ts: MessageInitShape<typeof TimestampSchema> | undefined): bigint {
  const seconds = BigInt(ts?.seconds ?? 0n);
  const nanos = ts?.nanos ?? 0;
  if (!ts || seconds < -62_135_596_800n || seconds > 253_402_300_799n || nanos < 0 || nanos > 999_999_999) throw codedError("invalid_request", Code.InvalidArgument);
  return seconds * 1_000_000n + BigInt(Math.floor(nanos / 1000));
}

/** Та же подача: время в подделке — Date (миллисекунды), в запросе — микросекунды. */
const sameSubmission = (stored: Date | null, expected: bigint) => stored !== null && BigInt(stored.getTime()) * 1000n === expected;

/** kycAudit в Go: статус, причина (по решению) и число файлов (при подаче) — без значений ПДн. */
const kycAudit = (status: KycStatus, extra: { reason?: string; idFiles?: number; registrationFiles?: number } = {}) => ({
  status: KycStatus[status],
  ...(extra.reason ? { reason: extra.reason } : {}),
  ...(extra.idFiles ? { id_files: extra.idFiles } : {}),
  ...(extra.registrationFiles ? { registration_files: extra.registrationFiles } : {}),
});

/** consent.go: версия текста, предмет (сделка), цели; пользователей в HasConsents — не больше 200. */
const CONSENT_VERSION_RE = /^[A-Za-z0-9.-]{1,32}$/;
const CONSENT_REFERENCE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const MAX_CONSENT_PURPOSES = 32;
const MAX_CONSENT_PURPOSE = 200;
const MAX_HAS_CONSENTS_USERS = 200;
/** workdays.go: срок ответа на отзыв — 15 рабочих дней по Алматы (с 01.03.2024 — UTC+5 без перехода на летнее время). */
const REVOCATION_WORKDAYS = 15;
const ALMATY_OFFSET_MS = 5 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Согласие в подделке: хэш — hex в нижнем регистре (в Go — байты). */
type StoredConsent = {
  id: string;
  userId: string;
  kind: ConsentKind;
  version: string;
  textSha256: string;
  purposes: string[];
  referenceId: string;
  channel: string;
  grantedAt: Date;
  revokedAt: Date | null;
};

type StoredRevocation = {
  id: string;
  userId: string;
  kind: ConsentKind;
  requestedAt: Date;
  dueAt: Date;
  status: RevocationStatus;
  decidedAt: Date | null;
  reason: string;
};

const consentKindOk = (k: ConsentKind | undefined): k is ConsentKind => k === ConsentKind.PD_PROCESSING || k === ConsentKind.BANK_TRANSFER;

/** consentProof в Go: версия по шаблону и SHA-256 — 64 hex-символа; иначе consent_version_invalid. Хэш — в нижнем регистре. */
function consentProof(version: string, sha: string): string {
  if (!CONSENT_VERSION_RE.test(version) || !SHA256_HEX_RE.test(sha)) throw codedError("consent_version_invalid", Code.InvalidArgument);
  return sha.toLowerCase();
}

/** validConsentReference в Go: ПДн — без предмета, передача банку — к сделке. */
const validConsentReference = (kind: ConsentKind, ref: string) => (kind === ConsentKind.PD_PROCESSING ? ref === "" : CONSENT_REFERENCE_RE.test(ref));

/** consentPurposes в Go: 1–32 цели по 1–200 символов после обрезки, повторы убираются; иначе invalid_request. */
function consentPurposes(raw: readonly string[]): string[] {
  if (raw.length === 0 || raw.length > MAX_CONSENT_PURPOSES) throw codedError("invalid_request", Code.InvalidArgument);
  const out: string[] = [];
  for (const r of raw) {
    const p = r.trim();
    if (p.length === 0 || p.length > MAX_CONSENT_PURPOSE) throw codedError("invalid_request", Code.InvalidArgument);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** revocationDue в Go: +15 рабочих дней (пн–пт по часам Алматы), время суток сохраняется. */
export function fakeRevocationDue(requested: Date): Date {
  let t = requested.getTime();
  for (let n = REVOCATION_WORKDAYS; n > 0; ) {
    t += DAY_MS;
    const wd = new Date(t + ALMATY_OFFSET_MS).getUTCDay();
    if (wd !== 0 && wd !== 6) n--;
  }
  return new Date(t);
}

/** revocationReason в Go: исполнение — причина пустая, отказ — 3–500 символов после обрезки; иначе invalid_request. */
function revocationReason(completed: boolean, raw: string): string {
  if (completed) {
    if (raw !== "") throw codedError("invalid_request", Code.InvalidArgument);
    return "";
  }
  const r = raw.trim();
  if (r.length < KYC_REASON_MIN || r.length > KYC_REASON_MAX) throw codedError("invalid_request", Code.InvalidArgument);
  return r;
}

const consentView = (c: StoredConsent): Consent =>
  create(ConsentSchema, {
    id: c.id,
    kind: c.kind,
    version: c.version,
    textSha256: c.textSha256,
    purposes: [...c.purposes],
    referenceId: c.referenceId,
    channel: c.channel,
    grantedAt: timestampFromDate(c.grantedAt),
    revokedAt: c.revokedAt ? timestampFromDate(c.revokedAt) : undefined,
  });

const revocationView = (r: StoredRevocation): ConsentRevocation =>
  create(ConsentRevocationSchema, {
    id: r.id,
    userId: r.userId,
    kind: r.kind,
    requestedAt: timestampFromDate(r.requestedAt),
    dueAt: timestampFromDate(r.dueAt),
    status: r.status,
    decidedAt: r.decidedAt ? timestampFromDate(r.decidedAt) : undefined,
    reason: r.reason,
  });

/** Проверенные реквизиты запроса (partyInput в Go). */
type PartyInput = Pick<StoredParty, "legalForm" | "legalName" | "binIin" | "signerFullName" | "signerIin">;

/** reveal.go: субъектов в одном вызове — не больше 50, reference_id — не длиннее 128. */
const MAX_REVEAL_USERS = 50;
const MAX_REFERENCE_ID = 128;
const REVEAL_PURPOSES: Partial<Record<RevealPurpose, string>> = {
  [RevealPurpose.CONTRACT]: "CONTRACT",
  [RevealPurpose.RELEASE_RECEIPT]: "RELEASE_RECEIPT",
  [RevealPurpose.PAYOUT]: "PAYOUT",
};

/** revealedFields в Go: имена непустых раскрытых полей (как в PartyDetails), без значений. */
function revealedFields(d: PartyDetails): string[] {
  const fields: [string, string][] = [
    ["full_name", d.fullName],
    ["iin", d.iin],
    ["legal_name", d.legalName],
    ["bin_iin", d.binIin],
    ["signer_full_name", d.signerFullName],
    ["signer_iin", d.signerIin],
    ["payout_iban", d.payoutIban],
  ];
  return fields.filter(([, value]) => value !== "").map(([name]) => name);
}

/** Пользователь сида и его сторона — как в запросе SeedUsers. */
type SeedUserInit = NonNullable<MessageInitShape<typeof SeedUsersRequestSchema>["users"]>[number];
type SeedPartyInit = NonNullable<SeedUserInit["party"]>;

/** Наименование стороны: 2–200 символов после обрезки пробелов (minLegalName, maxLegalName в Go). */
const LEGAL_NAME_MIN = 2;
const LEGAL_NAME_MAX = 200;

/** Событие аудита identity (outbox в Go): кто, что, о ком; значений ПДн нет. */
export type FakeAuditEvent = { userId: string; actorRole: Role; action: string; before?: unknown; after?: unknown };

/** checkInstagram в Go: пробелы по краям и одна ведущая «@» убираются; длиннее 30 — instagram_invalid с params.max. */
function checkInstagram(raw: string): string {
  const name = raw.trim().replace(/^@/, "");
  if (name.length > INSTAGRAM_MAX) throw codedError("instagram_invalid", Code.InvalidArgument, { max: String(INSTAGRAM_MAX) });
  if (!INSTAGRAM_RE.test(name)) throw codedError("instagram_invalid", Code.InvalidArgument);
  return name;
}

/** normalizeEmail в Go: пробелы по краям убираются, нижний регистр; пусто — не указан. */
function checkEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email === "") return "";
  if (email.length > EMAIL_MAX || !z.email().safeParse(email).success) throw codedError("email_invalid", Code.InvalidArgument);
  return email;
}

export type FakeUserInit = {
  /** По умолчанию `u-<цифры телефона>`; свой id нужен пользователям, которых тест создал в старой базе. */
  id?: string;
  phone: string;
  defaultRole?: Role;
  roles?: Role[];
  isDemo?: boolean;
  blocked?: boolean;
  /** Личность, уже записанная в identity (как сид SeedUsers): null и пусто — поле не указано. */
  person?: { fullName?: string | null; iin?: string | null; instagram?: string | null; email?: string | null };
  /** Сторона (реквизиты исполнителя), уже записанная в identity. */
  party?: Partial<StoredParty> & Pick<StoredParty, "legalForm" | "legalName" | "binIin">;
  /**
   * Согласие на обработку ПДн, уже данное (канал seed): по умолчанию — текущая редакция (пользователь теста не упирается в
   * экран согласия); false — согласия нет; своя версия и хэш — например, прежняя редакция.
   */
  consent?: false | { version: string; textSha256: string };
};

type StoredSession = { id: string; userId: string; activeRole: Role; mfaVerifiedAt: Date | null };
/** Фактор TOTP: секрет в base32 (в Go — шифртекст), подтверждён ли, последний принятый шаг. */
type StoredFactor = { secretBase32: string; secret: Buffer; confirmed: boolean; lastUsedStep: number };

/** ConnectError с `ErrorDetail` — как отвечает настоящий identity. */
export function codedError(code: string, status: Code, params: Record<string, string> = {}): ConnectError {
  return new ConnectError(code, status, undefined, [{ desc: ErrorDetailSchema, value: create(ErrorDetailSchema, { code, params }) }]);
}

const STATUS_BY_CODE: Record<string, Code> = {
  invalid_phone: Code.InvalidArgument,
  otp_too_often: Code.ResourceExhausted,
  otp_expired: Code.InvalidArgument,
  otp_wrong_code: Code.InvalidArgument,
  user_blocked: Code.PermissionDenied,
  session_invalid: Code.Unauthenticated,
  session_token_invalid: Code.InvalidArgument,
  role_not_granted: Code.PermissionDenied,
  role_forbidden: Code.PermissionDenied,
  demo_disabled: Code.FailedPrecondition,
  user_not_found: Code.NotFound,
  invalid_request: Code.InvalidArgument,
  mfa_required: Code.PermissionDenied,
  mfa_not_required: Code.FailedPrecondition,
  mfa_not_enrolled: Code.FailedPrecondition,
  mfa_already_enrolled: Code.FailedPrecondition,
  mfa_wrong_code: Code.InvalidArgument,
  mfa_code_reused: Code.InvalidArgument,
  mfa_too_many_attempts: Code.ResourceExhausted,
  idempotency_key_reused: Code.InvalidArgument,
  full_name_invalid: Code.InvalidArgument,
  iin_invalid: Code.InvalidArgument,
  iin_taken: Code.AlreadyExists,
  person_already_recorded: Code.FailedPrecondition,
  person_too_many_attempts: Code.ResourceExhausted,
  instagram_invalid: Code.InvalidArgument,
  email_invalid: Code.InvalidArgument,
  person_missing: Code.FailedPrecondition,
  bin_iin_invalid: Code.InvalidArgument,
  signer_required: Code.InvalidArgument,
  iban_invalid: Code.InvalidArgument,
  party_missing: Code.FailedPrecondition,
  party_exists: Code.FailedPrecondition,
  reveal_purpose_invalid: Code.InvalidArgument,
  kyc_transition_forbidden: Code.FailedPrecondition,
  kyc_documents_missing: Code.FailedPrecondition,
  kyc_reason_invalid: Code.InvalidArgument,
  consent_version_invalid: Code.InvalidArgument,
  consent_not_revocable: Code.FailedPrecondition,
  consent_missing: Code.FailedPrecondition,
  revocation_closed: Code.FailedPrecondition,
};

/** withoutSpaces в Go: все пробелы убраны (digits в registration-schema.ts). */
const withoutSpaces = (s: string) => s.replace(/\s/g, "");

/**
 * checkParty в Go: правовая форма (иначе invalid_request), наименование 2–200 символов (invalid_request), ИИН/БИН по форме
 * (ТОО — БИН, иначе ИИН; ownIin — ИП и самозанятый работают по ИИН личности, bin_iin не читается), подписант
 * (самозанятый — он сам, ИП — ФИО владельца, ТОО — ФИО и ИИН директора; нет — signer_required), формат ФИО и ИИН подписанта.
 */
function checkParty(form: LegalForm, rawName: string, rawBinIin: string, rawSigner: string, rawSignerIin: string, ownIin: boolean): PartyInput {
  if (form !== LegalForm.SELF_EMPLOYED && form !== LegalForm.IP && form !== LegalForm.TOO) throw codedError("invalid_request", Code.InvalidArgument);
  const legalName = rawName.trim();
  if (legalName.length < LEGAL_NAME_MIN || legalName.length > LEGAL_NAME_MAX) throw codedError("invalid_request", Code.InvalidArgument);
  let binIin = "";
  if (form === LegalForm.TOO || !ownIin) {
    binIin = withoutSpaces(rawBinIin);
    if (!(form === LegalForm.TOO ? isValidBin : isValidIin)(binIin)) throw codedError("bin_iin_invalid", Code.InvalidArgument);
  }
  let signerFullName = "";
  let signerIin = "";
  if (form === LegalForm.SELF_EMPLOYED) signerFullName = normalizeFullName(legalName);
  else if (form === LegalForm.IP) {
    signerFullName = normalizeFullName(rawSigner);
    if (signerFullName === "") throw codedError("signer_required", Code.InvalidArgument);
  } else {
    signerFullName = normalizeFullName(rawSigner);
    signerIin = withoutSpaces(rawSignerIin);
    if (signerFullName === "" || signerIin === "") throw codedError("signer_required", Code.InvalidArgument);
  }
  if (!isValidFullName(signerFullName)) throw codedError("full_name_invalid", Code.InvalidArgument);
  if (signerIin !== "" && !isValidIin(signerIin)) throw codedError("iin_invalid", Code.InvalidArgument);
  return { legalForm: form, legalName, binIin, signerFullName, signerIin };
}

/** replaceableKyc в Go: пока KYC не подана или отклонена, повторная анкета перезаписывает реквизиты (Ruling T). */
const REPLACEABLE_KYC: readonly KycStatus[] = [KycStatus.NOT_SUBMITTED, KycStatus.REJECTED];

/** sameParty в Go: у пользователя уже записаны те же реквизиты (повтор запроса). */
const sameParty = (p: StoredParty, input: PartyInput) =>
  p.legalForm === input.legalForm && p.legalName === input.legalName && p.binIin === input.binIin && p.signerFullName === input.signerFullName && p.signerIin === input.signerIin;

/** Как parsePhone в Go: «8 700 …», «+7 700 …», «700 …» -> +7700…; не телефон остаётся как есть и не пройдёт PHONE_RE. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && (digits[0] === "7" || digits[0] === "8") ? digits.slice(1) : digits;
  return /^[\d\s()+-]+$/.test(raw.trim()) && national.length === 10 ? `+7${national}` : raw;
}

/** id пользователя по телефону — UUID, как у identity (SeedConsents и другие методы в Go принимают только UUID); стабилен для номера. */
const idOf = (phone: string) => `00000000-0000-4000-8000-${phone.replace(/\D/g, "").slice(-12).padStart(12, "0")}`;

export class FakeIdentity {
  readonly client: IdentityClient;
  private users = new Map<string, User>(); // по id
  private blocked = new Set<string>();
  private sessions = new Map<string, StoredSession>(); // по токену
  /** Номера с действующим кодом: не больше одного кода на номер, как RetireOtpCodes в Go (новый запрос заменяет прежний, вход гасит). */
  private otpRequested = new Set<string>();
  private nextFailure: unknown[] = [];
  private counter = 0;
  private replays = new Map<string, { fingerprint: string; response: unknown }>(); // ключ: (метод, ключ идемпотентности), как PRIMARY KEY (method, key) в pkg/idem
  private effectThenFail: unknown = null;
  private factors = new Map<string, StoredFactor>(); // по id пользователя
  private mfaFailures = new Map<string, { windowStart: number; count: number }>(); // ключ mfa:<user_id> в Go
  private persons = new Map<string, StoredPerson>(); // по id пользователя
  private personAttempts = new Map<string, { windowStart: number; count: number }>(); // ключ identity:iin:user:<user_id> в Go
  private parties = new Map<string, StoredParty>(); // по id пользователя
  private consents: StoredConsent[] = [];
  private revocations: StoredRevocation[] = [];
  /** События аудита личности и контактов (в Go — outbox identity). */
  readonly auditEvents: FakeAuditEvent[] = [];
  /** Включён ли демо-режим (DEMO_MODE у настоящего сервиса). */
  demoEnabled = true;
  /** Часы сервиса (s.now в Go): шаг TOTP, окно лимита, отметка второй ступени. */
  now: () => Date = () => new Date();
  /** Токены, с которыми были вызваны методы, — для проверок в тестах. */
  readonly calls: { method: string; request: unknown }[] = [];

  constructor() {
    this.client = this.build();
  }

  /** Сбросить состояние перед тестом. */
  reset(): void {
    this.users.clear();
    this.blocked.clear();
    this.sessions.clear();
    this.otpRequested.clear();
    this.nextFailure = [];
    this.replays.clear();
    this.effectThenFail = null;
    this.calls.length = 0;
    this.demoEnabled = true;
    this.factors.clear();
    this.mfaFailures.clear();
    this.persons.clear();
    this.personAttempts.clear();
    this.parties.clear();
    this.consents = [];
    this.revocations = [];
    this.auditEvents.length = 0;
    this.now = () => new Date();
  }

  /** Следующий вызов (любого метода) бросит эту ошибку; можно поставить несколько — по одной на вызов. */
  failNext(error: unknown): void {
    this.nextFailure.push(error);
  }

  /** Следующий вызов вернёт identity с кодом ошибки контракта. */
  failNextWithCode(code: string, params: Record<string, string> = {}, status?: Code): void {
    this.failNext(codedError(code, status ?? STATUS_BY_CODE[code] ?? Code.FailedPrecondition, params));
  }

  /** Следующий вызов упадёт как при недоступном сервисе. */
  failNextUnavailable(): void {
    this.failNext(new ConnectError("unavailable", Code.Unavailable));
  }

  /**
   * Следующий изменяющий вызов выполнит действие (и запомнит ответ по ключу), а потом бросит `error` (по умолчанию
   * Unavailable): «обрыв связи после ответа»; Internal без ErrorDetail — сброс потока HTTP/2 после коммита.
   */
  failNextAfterEffect(error: unknown = new ConnectError("unavailable", Code.Unavailable)): void {
    this.effectThenFail = error;
  }

  /** Следующий вызов проходит как обычно — чтобы failNext сработал на вызове после него. */
  passNext(): void {
    this.nextFailure.push(undefined);
  }

  addUser(init: FakeUserInit): User {
    const defaultRole = init.defaultRole ?? Role.CLIENT;
    const user = create(UserSchema, {
      id: init.id ?? idOf(init.phone),
      phone: init.phone,
      defaultRole,
      roles: init.roles ?? [defaultRole],
      isDemo: init.isDemo ?? false,
      createdAt: timestampFromDate(new Date()),
    });
    this.users.set(user.id, user);
    if (init.blocked) this.block(user.id);
    if (init.person) {
      const p = init.person;
      this.persons.set(user.id, { fullName: p.fullName ?? "", iin: p.iin ?? "", instagram: p.instagram ?? "", email: p.email ?? "" });
    }
    if (init.party) {
      this.parties.set(user.id, {
        signerFullName: "",
        signerIin: "",
        payoutIban: "",
        ...noKyc(),
        ...init.party,
      });
    }
    if (init.consent !== false) {
      const c = init.consent ?? { version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };
      this.insertConsent({ userId: user.id, kind: ConsentKind.PD_PROCESSING, version: c.version, textSha256: c.textSha256, purposes: [], referenceId: "", channel: "seed" });
    }
    return user;
  }

  /** Новая запись согласия (InsertConsent/SeedConsent в Go): время — часы подделки. */
  private insertConsent(c: Omit<StoredConsent, "id" | "grantedAt" | "revokedAt">): StoredConsent {
    const row: StoredConsent = { ...c, id: randomUUID(), grantedAt: this.now(), revokedAt: null };
    this.consents.push(row);
    return row;
  }

  /** Действующие согласия вида пользователя (ListActiveConsents в Go), старые первыми. */
  private activeConsents(userId: string, kind: ConsentKind): StoredConsent[] {
    return this.consents.filter((c) => c.userId === userId && c.kind === kind && c.revokedAt === null);
  }

  /**
   * Согласие в обход GrantConsent — для фикстур: передача банку к сделке (`referenceId` — id сделки) или ПДн своей
   * редакции. Канал — seed.
   */
  grantConsentFor(userId: string, kind: "PD_PROCESSING" | "BANK_TRANSFER", opts: { referenceId?: string; version?: string; textSha256?: string } = {}): void {
    this.mustUser(userId);
    this.insertConsent({
      userId,
      kind: ConsentKind[kind],
      version: opts.version ?? consentDocument(kind).version,
      textSha256: opts.textSha256 ?? consentTextSha256(kind),
      purposes: [],
      referenceId: opts.referenceId ?? "",
      channel: "seed",
    });
  }

  /** Все согласия пользователя (с отозванными) — для проверок в тестах. */
  consentsOf(userId: string): StoredConsent[] {
    return this.consents.filter((c) => c.userId === userId).map((c) => ({ ...c, purposes: [...c.purposes] }));
  }

  /** Заявки пользователя на отзыв — для проверок в тестах. */
  revocationsOf(userId: string): StoredRevocation[] {
    return this.revocations.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }

  /** Сторона пользователя, как её отдаёт identity (номера — последними 4 символами); нет — undefined. */
  partyOf(userId: string): Party | undefined {
    const p = this.parties.get(userId);
    if (!p) return undefined;
    return create(PartySchema, {
      userId,
      legalForm: p.legalForm,
      legalName: p.legalName,
      binIinLast4: p.binIin.slice(-4),
      signerFullName: p.signerFullName,
      signerIinLast4: p.signerIin.slice(-4),
      payoutIbanLast4: p.payoutIban.slice(-4),
      kycStatus: p.kycStatus,
      kycRejectReason: p.kycRejectReason,
      kycSubmittedAt: p.kycSubmittedAt ? timestampFromDate(p.kycSubmittedAt) : undefined,
      kycReviewedAt: p.kycReviewedAt ? timestampFromDate(p.kycReviewedAt) : undefined,
      kycIdFileIds: [...p.kycIdFileIds],
      kycRegistrationFileIds: [...p.kycRegistrationFileIds],
    });
  }

  /** Открытые номера стороны — для проверок в тестах (в Go их отдаёт только RevealPartyDetails). */
  partyNumbersOf(userId: string): { binIin: string; signerIin: string; payoutIban: string } | undefined {
    const p = this.parties.get(userId);
    return p && { binIin: p.binIin, signerIin: p.signerIin, payoutIban: p.payoutIban };
  }

  /** Открытый ИИН личности — для проверок в тестах (в Go его отдаёт только RevealPartyDetails); нет — пустая строка. */
  personIinOf(userId: string): string {
    return this.persons.get(userId)?.iin ?? "";
  }

  /** Счёт выплаты стороны в обход SetPayoutIban — для тестов выплаты и расписки. */
  setPayoutIbanOf(userId: string, iban: string): void {
    const p = this.parties.get(userId);
    if (!p) throw new Error("подделка identity: стороны нет");
    p.payoutIban = iban;
  }

  /** partyDetails в Go: открытые данные пользователя — личность и сторона, если есть; undefined — пользователя нет. */
  private partyDetails(userId: string): PartyDetails | undefined {
    if (!this.users.has(userId)) return undefined;
    const person = this.persons.get(userId);
    const party = this.parties.get(userId);
    return create(PartyDetailsSchema, {
      userId,
      fullName: person?.fullName ?? "",
      iin: person?.iin ?? "",
      legalForm: party?.legalForm ?? LegalForm.UNSPECIFIED,
      legalName: party?.legalName ?? "",
      binIin: party?.binIin ?? "",
      signerFullName: party?.signerFullName ?? "",
      signerIin: party?.signerIin ?? "",
      payoutIban: party?.payoutIban ?? "",
    });
  }

  /** Личность пользователя, как её отдаёт identity (ИИН — последними 4 цифрами), — для проверок в тестах. */
  personOf(userId: string): Person {
    const p = this.persons.get(userId);
    return create(PersonSchema, { userId, fullName: p?.fullName ?? "", iinLast4: p?.iin.slice(-4) ?? "", instagram: p?.instagram ?? "", email: p?.email ?? "" });
  }

  hasUser(id: string): boolean {
    return this.users.has(id);
  }

  block(userId: string): void {
    this.blocked.add(userId);
  }

  /**
   * Создать сессию в обход OTP и вернуть токен — для тестов, которым нужен уже вошедший пользователь. Сессия оператора —
   * с пройденной второй ступенью сейчас; `mfaVerifiedAt` задаёт её момент (`null` — вход только по SMS).
   */
  signIn(userId: string, token: string, activeRole?: Role, opts: { mfaVerifiedAt?: Date | null } = {}): void {
    const user = this.mustUser(userId);
    const role = activeRole ?? user.defaultRole;
    const mfaVerifiedAt = opts.mfaVerifiedAt !== undefined ? opts.mfaVerifiedAt : role === Role.OPERATOR ? this.now() : null;
    this.sessions.set(token, { id: `s-${++this.counter}`, userId, activeRole: role, mfaVerifiedAt });
  }

  /** Подключённый фактор в обход Start/Confirm: секрет base32 (для кода в тесте). */
  enrollTotp(userId: string): string {
    this.mustUser(userId);
    const secret = randomBytes(20);
    const secretBase32 = toBase32(secret);
    this.factors.set(userId, { secretBase32, secret, confirmed: true, lastUsedStep: 0 });
    return secretBase32;
  }

  /** identity mfa-reset: фактор удаляется, отметка второй ступени снимается со всех сессий пользователя. */
  resetMfa(userId: string): void {
    this.factors.delete(userId);
    for (const s of this.sessions.values()) if (s.userId === userId) s.mfaVerifiedAt = null;
  }

  /** Есть ли у пользователя фактор и подтверждён ли он — для проверок в тестах. */
  factorState(userId: string): "none" | "pending" | "confirmed" {
    const f = this.factors.get(userId);
    return f ? (f.confirmed ? "confirmed" : "pending") : "none";
  }

  /** Отметка второй ступени сессии по токену — для проверок в тестах. */
  mfaVerifiedAtOf(token: string): Date | null | undefined {
    return this.sessions.get(token)?.mfaVerifiedAt;
  }

  sessionCount(userId?: string): number {
    return [...this.sessions.values()].filter((s) => userId === undefined || s.userId === userId).length;
  }

  private mustUser(id: string): User {
    const user = this.users.get(id);
    if (!user) throw codedError("user_not_found", Code.NotFound);
    return user;
  }

  private view(user: User): User {
    return create(UserSchema, {
      ...user,
      blockedAt: this.blocked.has(user.id) ? timestampFromDate(new Date()) : undefined,
    });
  }

  private sessionView(s: StoredSession): Session {
    const now = Date.now();
    return create(SessionSchema, {
      id: s.id,
      activeRole: s.activeRole,
      expiresAt: timestampFromDate(new Date(now + 7 * 24 * 3600_000)),
      idleExpiresAt: timestampFromDate(new Date(now + 30 * 60_000)),
      // Как sessionProto в Go: второй фактор нужен сессии оператора; отметка — когда пройден.
      mfaRequired: s.activeRole === Role.OPERATOR,
      mfaVerifiedAt: s.mfaVerifiedAt ? timestampFromDate(s.mfaVerifiedAt) : undefined,
    });
  }

  private enter(method: string, request: unknown): void {
    this.calls.push({ method, request });
    const failure = this.nextFailure.shift();
    if (failure !== undefined) throw failure;
  }

  /** Формат токена, который задаёт вызывающий (VerifyOtp, StartDemoSession). */
  private checkTokenShape(token: string): void {
    if (!TOKEN_SHAPE.test(token)) throw codedError("session_token_invalid", Code.InvalidArgument);
  }

  /** Токен уже у другой сессии (новый ключ, старый токен). */
  private checkTokenFree(token: string): void {
    if (this.sessions.has(token)) throw codedError("session_token_invalid", Code.InvalidArgument);
  }

  private checkKey(key: string | undefined): void {
    if (!key || key.length > MAX_KEY) throw codedError("invalid_request", Code.InvalidArgument);
  }

  /** Демо-методы: сначала режим (в Go — после проверки вызывающего), потом остальные проверки. */
  private demoGate(): void {
    if (!this.demoEnabled) throw codedError("demo_disabled", Code.FailedPrecondition);
  }

  /**
   * Изменяющий метод по контракту. Порядок как в Go: проверки запроса (`pre`, по умолчанию только ключ 1..128 символов),
   * затем поиск сохранённого ответа по (метод, ключ): тот же запрос — прежний ответ без второго эффекта, другой запрос —
   * idempotency_key_reused (отпечаток — детерминированный protobuf без самого ключа), затем действие.
   */
  private async once<S extends DescMessage, R>(
    method: string,
    schema: S,
    req: MessageInitShape<S>,
    run: () => Promise<R>,
    pre?: () => void | Promise<void>,
  ): Promise<R> {
    this.enter(method, req);
    const msg = create(schema, req);
    const key = "idempotencyKey" in msg && typeof msg.idempotencyKey === "string" ? msg.idempotencyKey : "";
    if (pre) await pre();
    else this.checkKey(key);
    const copy = clone(schema, msg);
    if ("idempotencyKey" in copy) copy.idempotencyKey = "";
    const fingerprint = Buffer.from(toBinary(schema, copy)).toString("base64");
    const slot = `${method}/${key}`;
    const seen = this.replays.get(slot);
    if (seen) {
      if (seen.fingerprint !== fingerprint) throw codedError("idempotency_key_reused", Code.InvalidArgument);
      return seen.response as R;
    }
    const response = await run();
    this.replays.set(slot, { fingerprint, response });
    if (this.effectThenFail !== null) {
      const failure = this.effectThenFail;
      this.effectThenFail = null;
      throw failure;
    }
    return response;
  }

  /**
   * validateSeed из demo.go: непустой список ≤ 200, телефоны верны и не повторяются, роли известны, роль по умолчанию выдана,
   * сотрудник один в своей роли; затем личность (validateSeedPerson) и сторона (validateSeedParty).
   */
  private validateSeed(users: SeedUserInit[]): void {
    if (users.length === 0 || users.length > 200) throw codedError("invalid_request", Code.InvalidArgument);
    const seen = new Set<string>();
    for (const u of users) {
      const phone = normalizePhone(u.phone ?? "");
      if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
      if (seen.has(phone)) throw codedError("invalid_request", Code.InvalidArgument);
      seen.add(phone);
      const roles = [...new Set(u.roles ?? [])];
      if (roles.some((r) => r === Role.UNSPECIFIED || !(r in Role))) throw codedError("invalid_request", Code.InvalidArgument);
      const def = u.defaultRole ?? Role.UNSPECIFIED;
      if (def === Role.UNSPECIFIED || !roles.includes(def)) throw codedError("invalid_request", Code.InvalidArgument);
      if (roles.some((r) => STAFF.includes(r)) && roles.length !== 1) throw codedError("invalid_request", Code.InvalidArgument);
      const person = this.seedPersonOf(u);
      if (u.party) this.seedPartyOf(u.party, roles, person.iin);
      // validateSeedConsent в Go: версия и хэш — вместе (invalid_request), по правилам GrantConsent.
      const version = u.consentVersion ?? "";
      const sha = u.consentTextSha256 ?? "";
      if ((version === "") !== (sha === "")) throw codedError("invalid_request", Code.InvalidArgument);
      if (version !== "") consentProof(version, sha);
    }
  }

  /** validateSeedPerson в Go: заданные поля личности — по правилам RecordPerson и UpdateContacts; пустое — не задано. */
  private seedPersonOf(u: SeedUserInit): Partial<StoredPerson> {
    const person: Partial<StoredPerson> = {};
    if (u.fullName) {
      person.fullName = normalizeFullName(u.fullName);
      if (!isValidFullName(person.fullName)) throw codedError("full_name_invalid", Code.InvalidArgument);
    }
    if (u.iin) {
      if (!isValidIin(u.iin)) throw codedError("iin_invalid", Code.InvalidArgument);
      person.iin = u.iin;
    }
    const instagram = checkInstagram(u.instagram ?? "");
    if (instagram) person.instagram = instagram;
    const email = checkEmail(u.email ?? "");
    if (email) person.email = email;
    return person;
  }

  /**
   * validateSeedParty в Go: сторона — только у исполнителя (иначе invalid_request); ИП и самозанятый без bin_iin — по ИИН
   * личности сида (нет — person_missing); IBAN — как SetPayoutIban; KYC — заданный или NOT_SUBMITTED.
   */
  private seedPartyOf(sp: SeedPartyInit, roles: readonly Role[], iin: string | undefined): StoredParty {
    if (!roles.includes(Role.EXECUTOR)) throw codedError("invalid_request", Code.InvalidArgument);
    const form = sp.legalForm ?? LegalForm.UNSPECIFIED;
    const own = (sp.binIin ?? "") === "" && form !== LegalForm.TOO;
    const input = checkParty(form, sp.legalName ?? "", sp.binIin ?? "", sp.signerFullName ?? "", sp.signerIin ?? "", own);
    if (own) {
      if (!iin) throw codedError("person_missing", Code.FailedPrecondition);
      input.binIin = iin;
    }
    let payoutIban = "";
    if (sp.payoutIban) {
      const check = parseKzIban(sp.payoutIban);
      if (!check.ok) throw codedError("iban_invalid", Code.InvalidArgument, { reason: check.reason });
      payoutIban = check.iban;
    }
    const raw = sp.kycStatus ?? KycStatus.UNSPECIFIED;
    if (raw !== KycStatus.UNSPECIFIED && !(raw in KycStatus)) throw codedError("invalid_request", Code.InvalidArgument);
    const kycStatus = raw === KycStatus.UNSPECIFIED ? KycStatus.NOT_SUBMITTED : raw;
    // validateSeedKyc в Go: файлы — как SubmitKyc и только при поданных документах; причина — только и обязательно у REJECTED.
    const kycIdFileIds = kycFileIds(sp.kycIdFileIds ?? []);
    const kycRegistrationFileIds = kycFileIds(sp.kycRegistrationFileIds ?? []);
    if (kycStatus === KycStatus.NOT_SUBMITTED && (kycIdFileIds.length > 0 || kycRegistrationFileIds.length > 0)) throw codedError("invalid_request", Code.InvalidArgument);
    let kycRejectReason = "";
    if (kycStatus === KycStatus.REJECTED) {
      kycRejectReason = (sp.kycRejectReason ?? "").trim();
      if (kycRejectReason.length < KYC_REASON_MIN || kycRejectReason.length > KYC_REASON_MAX) throw codedError("kyc_reason_invalid", Code.InvalidArgument);
    } else if (sp.kycRejectReason) throw codedError("invalid_request", Code.InvalidArgument);
    // seedPartyRow в Go: подача и решение — сейчас, если состояние их предполагает.
    const now = this.now();
    return {
      ...input,
      payoutIban,
      ...noKyc(),
      kycStatus,
      kycRejectReason,
      kycIdFileIds,
      kycRegistrationFileIds,
      kycSubmittedAt: kycStatus === KycStatus.NOT_SUBMITTED ? null : now,
      kycReviewedAt: kycStatus === KycStatus.VERIFIED || kycStatus === KycStatus.REJECTED ? now : null,
    };
  }

  private checkIp(ip: string): void {
    if (ip !== "" && isIP(ip) === 0) throw codedError("invalid_request", Code.InvalidArgument);
  }

  /** Активная роль по правилу сервиса: выданная роль сессии, иначе роль по умолчанию. */
  private effective(user: User, session: StoredSession): StoredSession {
    return user.roles.includes(session.activeRole) ? session : { ...session, activeRole: user.defaultRole };
  }

  private async sessionOf(token: string): Promise<{ user: User; session: StoredSession }> {
    const found = await this.lookup(token);
    return { user: found.user, session: this.effective(found.user, found.session) };
  }

  private async lookup(token: string): Promise<{ user: User; session: StoredSession }> {
    if (!TOKEN_SHAPE.test(token)) throw codedError("session_invalid", Code.Unauthenticated);
    const session = this.sessions.get(token);
    if (session) {
      if (this.blocked.has(session.userId)) throw codedError("session_invalid", Code.Unauthenticated);
      return { user: this.mustUser(session.userId), session };
    }
    throw codedError("session_invalid", Code.Unauthenticated);
  }

  /** operatorSession в Go: сессия действует, активная роль — оператор, иначе mfa_not_required. Сессия — хранимая (её отметку меняют). */
  private async operatorSession(token: string): Promise<{ user: User; session: StoredSession }> {
    const found = await this.lookup(token);
    if (this.effective(found.user, found.session).activeRole !== Role.OPERATOR) throw codedError("mfa_not_required", Code.FailedPrecondition);
    return found;
  }

  /** Проверка запроса кода (secondFactor в Go): ключ 1..128, код непуст и не длиннее 32 символов. */
  private checkCodeRequest(key: string | undefined, code: string | undefined): void {
    if (!key || key.length > MAX_KEY || !code || code.length > MAX_TOTP_CODE_LEN) throw codedError("invalid_request", Code.InvalidArgument);
  }

  /** HitRateLimit: фиксированное окно 15 минут; возвращает число попыток в окне, включая эту. */
  private hitMfaLimit(userId: string): number {
    const now = this.now().getTime();
    const cur = this.mfaFailures.get(userId);
    const next = !cur || cur.windowStart < now - MFA_FAILURE_WINDOW_MS ? { windowStart: now, count: 1 } : { ...cur, count: cur.count + 1 };
    this.mfaFailures.set(userId, next);
    return next.count;
  }

  /** limiter.hit в person.go: фиксированное окно 1 ч; true — попытка укладывается в лимит. */
  private hitPersonLimit(userId: string): boolean {
    const now = this.now().getTime();
    const cur = this.personAttempts.get(userId);
    const next = !cur || cur.windowStart < now - PERSON_ATTEMPT_WINDOW_MS ? { windowStart: now, count: 1 } : { ...cur, count: cur.count + 1 };
    this.personAttempts.set(userId, next);
    return next.count <= PERSON_MAX_ATTEMPTS;
  }

  /** Транзакция RecordPerson: личность заново (тот же ИИН — тот же ответ), занятый ИИН, запись и аудит без значений. */
  private recordPersonTx(user: User, session: StoredSession, fullName: string, iin: string): Person {
    const current = this.persons.get(user.id);
    if (current?.iin) {
      if (current.iin !== iin) throw codedError("person_already_recorded", Code.FailedPrecondition);
      return this.personOf(user.id);
    }
    for (const [id, p] of this.persons) if (id !== user.id && p.iin === iin) throw codedError("iin_taken", Code.AlreadyExists);
    // Уже указанное ФИО не меняется — только дополняется ИИН (COALESCE в RecordPersonIIN).
    this.persons.set(user.id, { fullName: current?.fullName || fullName, iin, instagram: current?.instagram ?? "", email: current?.email ?? "" });
    this.auditEvents.push({ userId: user.id, actorRole: session.activeRole, action: "user.identity.recorded" });
    return this.personOf(user.id);
  }

  /**
   * writeParty в Go: у пользователя уже есть сторона — те же реквизиты дают её же ("same"); другие — перезапись
   * ("replace"), если `replace` (RegisterParty) и KYC не подана или отклонена, иначе party_exists; ИИН/БИН другой стороны —
   * iin_taken. Ничего не меняет: запись — `commitParty` после всех проверок «транзакции».
   */
  private checkWriteParty(userId: string | null, input: PartyInput, replace: boolean): "same" | "create" | "replace" {
    const existing = userId === null ? undefined : this.parties.get(userId);
    if (existing && sameParty(existing, input)) return "same";
    if (existing && !(replace && REPLACEABLE_KYC.includes(existing.kycStatus))) throw codedError("party_exists", Code.FailedPrecondition);
    for (const [id, p] of this.parties) if (id !== userId && p.binIin === input.binIin) throw codedError("iin_taken", Code.AlreadyExists);
    return existing ? "replace" : "create";
  }

  /**
   * Запись стороны: новая — KYC не подана, аудит party.registered; перезапись — счёт выплаты и KYC остаются, аудит
   * party.replaced. В аудите только правовая форма.
   */
  private commitParty(userId: string, input: PartyInput, actorRole: Role, write: "same" | "create" | "replace"): void {
    const before = this.parties.get(userId);
    if (write === "same") return;
    if (write === "replace" && before) {
      this.parties.set(userId, { ...before, ...input });
      this.auditEvents.push({ userId, actorRole, action: "party.replaced", before: { legal_form: LegalForm[before.legalForm] }, after: { legal_form: LegalForm[input.legalForm] } });
      return;
    }
    this.parties.set(userId, { ...input, payoutIban: "", ...noKyc() });
    this.auditEvents.push({ userId, actorRole, action: "party.registered", after: { legal_form: LegalForm[input.legalForm] } });
  }

  /**
   * KYC на проверке или пройдена — для проверок в тестах (в Go её меняют SubmitKyc и ReviewKyc); `reason` — причина
   * отказа, `files` — поданные документы (как setKyc в тестах Go).
   */
  setKycStatus(userId: string, status: KycStatus, opts: { reason?: string; files?: { id: string[]; registration: string[] } } = {}): void {
    const p = this.parties.get(userId);
    if (!p) throw new Error("подделка identity: стороны нет");
    p.kycStatus = status;
    p.kycRejectReason = opts.reason ?? "";
    if (opts.files) {
      p.kycIdFileIds = [...opts.files.id];
      p.kycRegistrationFileIds = [...opts.files.registration];
      p.kycSubmittedAt = this.now();
    }
  }

  /** Сторона в ответе: только что записанная или прежняя. */
  private mustParty(userId: string): Party {
    const party = this.partyOf(userId);
    if (!party) throw new Error("подделка identity: стороны нет после записи");
    return party;
  }

  /** operatorWithMfa в Go: активная роль — оператор (иначе role_forbidden), вторая ступень пройдена (иначе mfa_required). */
  private operatorWithMfa(session: StoredSession): void {
    if (session.activeRole !== Role.OPERATOR) throw codedError("role_forbidden", Code.PermissionDenied);
    if (!session.mfaVerifiedAt) throw codedError("mfa_required", Code.PermissionDenied);
  }

  /**
   * executorByPhone и writeParty в Go одной «транзакцией»: сотрудник — role_forbidden, заблокированный — user_blocked, затем
   * проверки стороны; только после них — новый пользователь (UserRegistered) или добавленная роль (RoleGranted) и сторона.
   */
  private provision(phone: string, input: PartyInput): { user: User; party: Party } {
    let user = [...this.users.values()].find((u) => u.phone === phone);
    if (user) {
      if (user.roles.some((r) => STAFF.includes(r))) throw codedError("role_forbidden", Code.PermissionDenied);
      if (this.blocked.has(user.id)) throw codedError("user_blocked", Code.PermissionDenied);
    }
    const write = this.checkWriteParty(user?.id ?? null, input, false);
    if (!user) {
      user = this.addUser({ phone, defaultRole: Role.EXECUTOR, roles: [Role.EXECUTOR], consent: false });
      this.auditEvents.push({ userId: user.id, actorRole: Role.OPERATOR, action: "user.registered", after: { role: "EXECUTOR" } });
    } else if (!user.roles.includes(Role.EXECUTOR)) {
      user = create(UserSchema, { ...user, roles: [...user.roles, Role.EXECUTOR] });
      this.users.set(user.id, user);
      this.auditEvents.push({ userId: user.id, actorRole: Role.OPERATOR, action: "user.role_granted", after: { role: "EXECUTOR" } });
    }
    this.commitParty(user.id, input, Role.OPERATOR, write);
    return { user: this.view(user), party: this.mustParty(user.id) };
  }

  private refundMfaLimit(userId: string): void {
    const cur = this.mfaFailures.get(userId);
    if (cur && cur.count > 0) cur.count -= 1;
  }

  /** totpMatch в Go: шаг окна ±1 вокруг сейчас, больше minStep, с тем же кодом; null — нет такого. */
  private totpMatch(secret: Buffer, code: string, minStep: number): number | null {
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) return null;
    const cur = totpStep(this.now());
    for (let s = cur - 1; s <= cur + 1; s++) if (s > minStep && totpCode(secret, s) === c) return s;
    return null;
  }

  /** checkTotp и acceptTotp в Go: фактор, лимит (до сравнения), код, затем шаг, возврат попытки и отметка сессии. */
  private acceptCode(user: User, session: StoredSession, code: string, enrolling: boolean): Session {
    const f = this.factors.get(user.id);
    if (!f) throw codedError("mfa_not_enrolled", Code.FailedPrecondition);
    if (enrolling && f.confirmed) throw codedError("mfa_already_enrolled", Code.FailedPrecondition);
    if (!enrolling && !f.confirmed) throw codedError("mfa_not_enrolled", Code.FailedPrecondition);
    const attempts = this.hitMfaLimit(user.id);
    if (attempts > MFA_MAX_FAILURES) throw codedError("mfa_too_many_attempts", Code.ResourceExhausted);
    const step = this.totpMatch(f.secret, code, f.lastUsedStep);
    if (step === null) {
      if (this.totpMatch(f.secret, code, Number.MIN_SAFE_INTEGER) !== null) throw codedError("mfa_code_reused", Code.InvalidArgument);
      throw codedError("mfa_wrong_code", Code.InvalidArgument, { left: String(Math.max(MFA_MAX_FAILURES - attempts, 0)) });
    }
    f.lastUsedStep = step;
    f.confirmed = true;
    this.refundMfaLimit(user.id);
    session.mfaVerifiedAt = this.now();
    return this.sessionView(this.effective(user, session));
  }

  private build(): IdentityClient {
    const mutating =
      <S extends DescMessage, R>(name: string, schema: S, fn: (req: MessageInitShape<S>) => Promise<R>, pre?: (req: MessageInitShape<S>) => void | Promise<void>) =>
      (req: MessageInitShape<S>): Promise<R> =>
        this.once(name, schema, req, () => fn(req), pre && (() => pre(req)));
    const reading = <Q, R>(name: string, fn: (req: Q) => Promise<R>) => async (req: Q): Promise<R> => {
      this.enter(name, req);
      return fn(req);
    };
    const unimplemented = async (): Promise<never> => {
      throw new ConnectError("не реализовано в подделке", Code.Unimplemented);
    };
    return {
      requestOtp: mutating(
        "requestOtp",
        RequestOtpRequestSchema,
        async (req) => {
          const phone = req.phone ?? "";
          this.otpRequested.add(phone);
          return create(RequestOtpResponseSchema, { phone, expiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)), demoCode: this.demoEnabled ? FAKE_OTP_CODE : "" });
        },
        (req) => {
          this.checkKey(req.idempotencyKey);
          if (!PHONE_RE.test(req.phone ?? "")) throw codedError("invalid_phone", Code.InvalidArgument);
          this.checkIp(req.clientIp ?? "");
        },
      ),
      verifyOtp: mutating(
        "verifyOtp",
        VerifyOtpRequestSchema,
        async (req) => {
          const phone = req.phone ?? "";
          this.checkTokenFree(req.sessionToken ?? "");
          if (!this.otpRequested.has(phone)) throw codedError("otp_expired", Code.InvalidArgument);
          if (req.code !== FAKE_OTP_CODE) throw codedError("otp_wrong_code", Code.InvalidArgument, { left: "4" });
          const existing = [...this.users.values()].find((u) => u.phone === phone); // как в Go: пользователь ищется по телефону
          if (existing && this.blocked.has(existing.id)) throw codedError("user_blocked", Code.PermissionDenied);
          const user = existing ?? this.addUser({ phone, consent: false });
          this.otpRequested.delete(phone);
          // Вход по SMS: второй ступени в этой сессии ещё нет (у оператора — /operator/mfa).
          const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: user.defaultRole, mfaVerifiedAt: null };
          this.sessions.set(req.sessionToken ?? "", session);
          return create(VerifyOtpResponseSchema, { user: this.view(user), session: this.sessionView(session), isNew: !existing });
        },
        (req) => {
          // Порядок Go (verify.go): формат токена, ключ, IP, телефон; дальше поиск ответа по ключу, занятый токен, код.
          this.checkTokenShape(req.sessionToken ?? "");
          this.checkKey(req.idempotencyKey);
          this.checkIp(req.clientIp ?? "");
          if (!PHONE_RE.test(req.phone ?? "")) throw codedError("invalid_phone", Code.InvalidArgument);
        },
      ),
      authenticate: reading("authenticate", async (req: MessageInitShape<typeof AuthenticateRequestSchema>) => {
        const { user, session } = await this.sessionOf(req.sessionToken ?? "");
        return create(AuthenticateResponseSchema, {
          user: this.view(user),
          session: this.sessionView(session),
          accessToken: `fake-access-${user.id}`,
          accessExpiresAt: timestampFromDate(new Date(Date.now() + 5 * 60_000)),
          // Как Authenticate в Go: только действующие согласия на ПДн (передача банку — HasConsents).
          consents: this.activeConsents(user.id, ConsentKind.PD_PROCESSING).map(consentView),
        });
      }),
      signOut: mutating("signOut", SignOutRequestSchema, async (req) => {
        // Неверный или неизвестный токен — не ошибка: выйти из несуществующей сессии можно.
        this.sessions.delete(req.sessionToken ?? "");
        return create(SignOutResponseSchema);
      }),
      signOutEverywhere: mutating("signOutEverywhere", SignOutEverywhereRequestSchema, async (req) => {
        // Токен, по которому нельзя доказать вход (кривой, неизвестный, отозванный, истёкший, заблокированный), — успех без изменений.
        const found = await this.lookup(req.sessionToken ?? "").catch(() => null);
        if (found) for (const [token, s] of this.sessions) if (s.userId === found.user.id) this.sessions.delete(token);
        return create(SignOutEverywhereResponseSchema);
      }),
      switchRole: mutating("switchRole", SwitchRoleRequestSchema, async (req) => {
        const { user, session } = await this.lookup(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (!user.roles.includes(role)) throw codedError("role_not_granted", Code.PermissionDenied);
        session.activeRole = role;
        const updated = create(UserSchema, { ...user, defaultRole: role });
        this.users.set(user.id, updated);
        return create(SwitchRoleResponseSchema, { user: this.view(updated), session: this.sessionView(session) });
      }),
      grantRole: mutating("grantRole", GrantRoleRequestSchema, async (req) => {
        const { user } = await this.sessionOf(req.sessionToken ?? "");
        const role = req.role ?? Role.UNSPECIFIED;
        if (role === Role.UNSPECIFIED) throw codedError("invalid_request", Code.InvalidArgument);
        if (STAFF.includes(role) || user.roles.some((r) => STAFF.includes(r))) throw codedError("role_forbidden", Code.PermissionDenied);
        if (user.roles.includes(role)) return create(GrantRoleResponseSchema, { user: this.view(user), granted: false });
        const updated = create(UserSchema, { ...user, roles: [...user.roles, role] });
        this.users.set(user.id, updated);
        return create(GrantRoleResponseSchema, { user: this.view(updated), granted: true });
      }),
      startDemoSession: mutating(
        "startDemoSession",
        StartDemoSessionRequestSchema,
        async (req) => {
          // Нет пользователя, он не демо или заблокирован — один отказ: метод не показывает, кто есть.
          const user = this.users.get(req.userId ?? "");
          if (!user || !user.isDemo || this.blocked.has(user.id)) throw codedError("user_not_found", Code.NotFound);
          const asRole = req.asRole ? req.asRole : user.defaultRole;
          if (!user.roles.includes(asRole)) throw codedError("role_not_granted", Code.PermissionDenied);
          this.checkTokenFree(req.sessionToken ?? "");
          // Демо-оператор считается прошедшим вторую ступень (demo.go: у демо-персон нет приложения).
          const session: StoredSession = { id: `s-${++this.counter}`, userId: user.id, activeRole: asRole, mfaVerifiedAt: asRole === Role.OPERATOR ? this.now() : null };
          this.sessions.set(req.sessionToken ?? "", session);
          return create(StartDemoSessionResponseSchema, { user: this.view(user), session: this.sessionView(session) });
        },
        (req) => {
          // Порядок Go (demo.go): режим, формат токена, ключ, роль.
          this.demoGate();
          this.checkTokenShape(req.sessionToken ?? "");
          this.checkKey(req.idempotencyKey);
          if (req.asRole !== undefined && req.asRole !== Role.UNSPECIFIED && !(req.asRole in Role)) throw codedError("invalid_request", Code.InvalidArgument);
        },
      ),
      seedUsers: mutating(
        "seedUsers",
        SeedUsersRequestSchema,
        async (req) => {
          // Как UpsertSeedUser в Go: по телефону; у существующего id прежний, роли, демо-флаг и created_at (если задан) — из запроса, блокировка снимается.
          const seeded: User[] = [];
          for (const u of req.users ?? []) {
            const phone = normalizePhone(u.phone ?? "");
            const existing = [...this.users.values()].find((x) => x.phone === phone);
            const user = this.addUser({ id: existing?.id, phone, defaultRole: u.defaultRole, roles: [...new Set((u.roles ?? []) as Role[])], isDemo: u.isDemo ?? false, consent: false });
            const createdAt = u.createdAt ? create(TimestampSchema, u.createdAt) : existing?.createdAt;
            if (createdAt) user.createdAt = createdAt;
            this.blocked.delete(user.id);
            // seedPerson и seedPartyRow в Go: заданные поля личности перезаписываются, сторона — целиком.
            const person = this.seedPersonOf(u);
            if (Object.keys(person).length > 0) {
              this.persons.set(user.id, { ...(this.persons.get(user.id) ?? { fullName: "", iin: "", instagram: "", email: "" }), ...person });
            }
            if (u.party) this.parties.set(user.id, this.seedPartyOf(u.party, user.roles, this.persons.get(user.id)?.iin));
            // SeedConsent в Go: действующее согласие той же версии уже есть — без изменений.
            const version = u.consentVersion ?? "";
            if (version !== "" && !this.activeConsents(user.id, ConsentKind.PD_PROCESSING).some((c) => c.version === version)) {
              const textSha256 = (u.consentTextSha256 ?? "").toLowerCase();
              this.insertConsent({ userId: user.id, kind: ConsentKind.PD_PROCESSING, version, textSha256, purposes: [], referenceId: "", channel: "seed" });
            }
            seeded.push(user);
          }
          return create(SeedUsersResponseSchema, { users: seeded.map((u) => this.view(u)) });
        },
        (req) => {
          this.demoGate();
          this.checkKey(req.idempotencyKey);
          this.validateSeed(req.users ?? []);
        },
      ),
      seedConsents: mutating(
        "seedConsents",
        SeedConsentsRequestSchema,
        async (req) => {
          // Транзакция Go: пользователь должен существовать (признак демо не нужен, Ruling AG); действующее той же версии и
          // предмета — без новой записи, другой текст — consent_version_invalid; всё или ничего.
          const rows = (req.consents ?? []).map((c) => ({ userId: c.userId ?? "", kind: c.kind as ConsentKind, version: c.version ?? "", textSha256: consentProof(c.version ?? "", c.textSha256 ?? ""), referenceId: c.referenceId ?? "" }));
          const fresh: typeof rows = [];
          for (const r of rows) {
            if (!this.users.has(r.userId)) throw codedError("user_not_found", Code.NotFound);
            const existing = [...this.activeConsents(r.userId, r.kind), ...fresh].find((c) => c.userId === r.userId && c.kind === r.kind && c.version === r.version && c.referenceId === r.referenceId);
            if (existing && existing.textSha256 !== r.textSha256) throw codedError("consent_version_invalid", Code.InvalidArgument);
            if (!existing) fresh.push(r);
          }
          for (const r of fresh) this.insertConsent({ ...r, purposes: [], channel: "seed" });
          return create(SeedConsentsResponseSchema);
        },
        // Порядок Go (demo.go): режим, ключ, затем validateSeedConsents — 1–500 записей, UUID, вид, предмет, версия и хэш.
        (req) => {
          this.demoGate();
          this.checkKey(req.idempotencyKey);
          const consents = req.consents ?? [];
          if (consents.length === 0 || consents.length > 500) throw codedError("invalid_request", Code.InvalidArgument);
          for (const c of consents) {
            if (!UUID_RE.test(c.userId ?? "")) throw codedError("invalid_request", Code.InvalidArgument);
            if (!consentKindOk(c.kind) || !validConsentReference(c.kind, c.referenceId ?? "")) throw codedError("invalid_request", Code.InvalidArgument);
            consentProof(c.version ?? "", c.textSha256 ?? "");
          }
        },
      ),
      resetDemo: mutating(
        "resetDemo",
        ResetDemoRequestSchema,
        async () => {
          // Пользователи остаются; сессии, коды и сохранённые ответы стираются (свой ответ once() запишет после очистки).
          this.sessions.clear();
          this.otpRequested.clear();
          this.replays.clear();
          this.mfaFailures.clear();
          this.factors.clear(); // Ruling E: повторный прогон e2e подключает TOTP заново
          // identity_purge_demo_consents в Go: согласия и заявки на отзыв демо-пользователей удаляются.
          const demo = (userId: string) => this.users.get(userId)?.isDemo === true;
          this.consents = this.consents.filter((c) => !demo(c.userId));
          this.revocations = this.revocations.filter((r) => !demo(r.userId));
          return create(ResetDemoResponseSchema);
        },
        (req) => {
          this.demoGate();
          this.checkKey(req.idempotencyKey);
        },
      ),
      getSigningKeys: unimplemented,
      startTotpEnrollment: async (req: MessageInitShape<typeof StartTotpEnrollmentRequestSchema>) => {
        let userId = "";
        const res = await this.once(
          "startTotpEnrollment",
          StartTotpEnrollmentRequestSchema,
          req,
          async () => {
            // Повтор до подтверждения заменяет неподтверждённый секрет новым; подключённый фактор не меняется.
            if (this.factors.get(userId)?.confirmed) throw codedError("mfa_already_enrolled", Code.FailedPrecondition);
            const secret = randomBytes(20);
            const secretBase32 = toBase32(secret);
            this.factors.set(userId, { secretBase32, secret, confirmed: false, lastUsedStep: 0 });
            return create(StartTotpEnrollmentResponseSchema, { secretBase32 });
          },
          // Порядок Go: ключ, сессия и роль; дальше повтор по ключу.
          async () => {
            this.checkKey(req.idempotencyKey);
            userId = (await this.operatorSession(req.sessionToken ?? "")).user.id;
          },
        );
        // После повтора по ключу: секрет показывается только до подключения и только пока он действует.
        const factor = this.factors.get(userId);
        if (factor?.confirmed) throw codedError("mfa_already_enrolled", Code.FailedPrecondition);
        if (!factor || factor.secretBase32 !== res.secretBase32) throw codedError("idempotency_key_reused", Code.InvalidArgument);
        return res;
      },
      confirmTotpEnrollment: mutating(
        "confirmTotpEnrollment",
        ConfirmTotpEnrollmentRequestSchema,
        async (req) => {
          const { user, session } = await this.operatorSession(req.sessionToken ?? "");
          return create(ConfirmTotpEnrollmentResponseSchema, { session: this.acceptCode(user, session, req.code ?? "", true) });
        },
        async (req) => {
          this.checkCodeRequest(req.idempotencyKey, req.code);
          await this.operatorSession(req.sessionToken ?? "");
        },
      ),
      verifySecondFactor: mutating(
        "verifySecondFactor",
        VerifySecondFactorRequestSchema,
        async (req) => {
          const { user, session } = await this.operatorSession(req.sessionToken ?? "");
          return create(VerifySecondFactorResponseSchema, { session: this.acceptCode(user, session, req.code ?? "", false) });
        },
        async (req) => {
          this.checkCodeRequest(req.idempotencyKey, req.code);
          await this.operatorSession(req.sessionToken ?? "");
        },
      ),
      recordPerson: mutating(
        "recordPerson",
        RecordPersonRequestSchema,
        async (req) => {
          const { user, session } = await this.sessionOf(req.sessionToken ?? "");
          const iin = req.iin ?? "";
          // До лимита: тот же ИИН ещё раз — тот же ответ без попытки, другой поверх записанного — отказ.
          const current = this.persons.get(user.id);
          if (current?.iin) {
            if (current.iin !== iin) throw codedError("person_already_recorded", Code.FailedPrecondition);
            return create(RecordPersonResponseSchema, { person: this.personOf(user.id) });
          }
          if (!this.hitPersonLimit(user.id)) throw codedError("person_too_many_attempts", Code.ResourceExhausted);
          return create(RecordPersonResponseSchema, { person: this.recordPersonTx(user, session, normalizeFullName(req.fullName ?? ""), iin) });
        },
        async (req) => {
          // Порядок Go (person.go): ключ, ФИО, ИИН, сессия; дальше повтор по ключу, личность, лимит, транзакция.
          this.checkKey(req.idempotencyKey);
          if (!isValidFullName(req.fullName ?? "")) throw codedError("full_name_invalid", Code.InvalidArgument);
          if (!isValidIin(req.iin ?? "")) throw codedError("iin_invalid", Code.InvalidArgument);
          await this.lookup(req.sessionToken ?? "");
        },
      ),
      updateContacts: mutating(
        "updateContacts",
        UpdateContactsRequestSchema,
        async (req) => {
          // Транзакция Go: сессия под блокировкой, активная роль — сторона сделки, полная замена обоих полей.
          const { user, session } = await this.sessionOf(req.sessionToken ?? "");
          if (session.activeRole !== Role.CLIENT && session.activeRole !== Role.EXECUTOR) throw codedError("role_forbidden", Code.PermissionDenied);
          const before = this.persons.get(user.id) ?? { fullName: "", iin: "", instagram: "", email: "" };
          const after = { ...before, instagram: checkInstagram(req.instagram ?? ""), email: checkEmail(req.email ?? "") };
          this.persons.set(user.id, after);
          for (const [field, action] of [["instagram", "user.instagram_changed"], ["email", "user.email_changed"]] as const) {
            if (before[field] === after[field]) continue;
            this.auditEvents.push({ userId: user.id, actorRole: session.activeRole, action, before: { set: before[field] !== "" }, after: { set: after[field] !== "" } });
          }
          return create(UpdateContactsResponseSchema, { person: this.personOf(user.id) });
        },
        (req) => {
          // Порядок Go: ключ, Instagram, e-mail; дальше повтор по ключу и транзакция.
          this.checkKey(req.idempotencyKey);
          checkInstagram(req.instagram ?? "");
          checkEmail(req.email ?? "");
        },
      ),
      getProfile: reading("getProfile", async (req: MessageInitShape<typeof GetProfileRequestSchema>) => {
        const { user } = await this.lookup(req.sessionToken ?? "");
        return create(GetProfileResponseSchema, { person: this.personOf(user.id), party: this.partyOf(user.id) });
      }),
      registerParty: (req: MessageInitShape<typeof RegisterPartyRequestSchema>) => {
        let input: PartyInput | undefined;
        return this.once(
          "registerParty",
          RegisterPartyRequestSchema,
          req,
          async () => {
            // Транзакция Go: сессия и роль заново, ИИН личности (ИП и самозанятый), сторона, аудит без значений.
            const { user, session } = await this.sessionOf(req.sessionToken ?? "");
            if (!user.roles.includes(Role.EXECUTOR)) throw codedError("role_not_granted", Code.PermissionDenied);
            const own = { ...input! };
            if (own.legalForm !== LegalForm.TOO) {
              const iin = this.persons.get(user.id)?.iin ?? "";
              if (iin === "") throw codedError("person_missing", Code.FailedPrecondition);
              own.binIin = iin;
            }
            this.commitParty(user.id, own, session.activeRole, this.checkWriteParty(user.id, own, true));
            return create(RegisterPartyResponseSchema, { party: this.mustParty(user.id) });
          },
          // Порядок Go (party.go): ключ, реквизиты, сессия, роль EXECUTOR среди выданных; дальше повтор по ключу.
          async () => {
            this.checkKey(req.idempotencyKey);
            input = checkParty(req.legalForm ?? LegalForm.UNSPECIFIED, req.legalName ?? "", req.binIin ?? "", req.signerFullName ?? "", req.signerIin ?? "", true);
            const { user } = await this.lookup(req.sessionToken ?? "");
            if (!user.roles.includes(Role.EXECUTOR)) throw codedError("role_not_granted", Code.PermissionDenied);
          },
        );
      },
      provisionExecutor: (req: MessageInitShape<typeof ProvisionExecutorRequestSchema>) => {
        let phone = "";
        let input: PartyInput | undefined;
        return this.once(
          "provisionExecutor",
          ProvisionExecutorRequestSchema,
          req,
          async () => {
            const { session } = await this.sessionOf(req.sessionToken ?? "");
            this.operatorWithMfa(session);
            return create(ProvisionExecutorResponseSchema, this.provision(phone, input!));
          },
          // Порядок Go: ключ, телефон, реквизиты (ИИН/БИН из запроса), сессия, оператор со второй ступенью.
          async () => {
            this.checkKey(req.idempotencyKey);
            phone = normalizePhone(req.phone ?? "");
            if (!PHONE_RE.test(phone)) throw codedError("invalid_phone", Code.InvalidArgument);
            input = checkParty(req.legalForm ?? LegalForm.UNSPECIFIED, req.legalName ?? "", req.binIin ?? "", req.signerFullName ?? "", req.signerIin ?? "", false);
            this.operatorWithMfa((await this.sessionOf(req.sessionToken ?? "")).session);
          },
        );
      },
      setPayoutIban: (req: MessageInitShape<typeof SetPayoutIbanRequestSchema>) => {
        let iban = "";
        return this.once(
          "setPayoutIban",
          SetPayoutIbanRequestSchema,
          req,
          async () => {
            const { user, session } = await this.sessionOf(req.sessionToken ?? "");
            if (session.activeRole !== Role.EXECUTOR) throw codedError("role_forbidden", Code.PermissionDenied);
            const party = this.parties.get(user.id);
            if (!party) throw codedError("party_missing", Code.FailedPrecondition);
            // Тот же счёт ещё раз — без изменений и без аудита, changed=false; иначе аудит только «указан / не указан».
            const changed = party.payoutIban !== iban;
            if (changed) {
              this.auditEvents.push({ userId: user.id, actorRole: Role.EXECUTOR, action: "executor.payout_iban_changed", before: { set: party.payoutIban !== "" }, after: { set: true } });
              party.payoutIban = iban;
            }
            return create(SetPayoutIbanResponseSchema, { party: this.mustParty(user.id), changed });
          },
          // Порядок Go: ключ, IBAN (format или checksum), сессия, активная роль исполнителя.
          async () => {
            this.checkKey(req.idempotencyKey);
            const check = parseKzIban(req.iban ?? "");
            if (!check.ok) throw codedError("iban_invalid", Code.InvalidArgument, { reason: check.reason });
            iban = check.iban;
            if ((await this.sessionOf(req.sessionToken ?? "")).session.activeRole !== Role.EXECUTOR) throw codedError("role_forbidden", Code.PermissionDenied);
          },
        );
      },
      verifySignerIin: reading("verifySignerIin", async (req: MessageInitShape<typeof VerifySignerIinRequestSchema>) => {
        // Порядок Go: пользователь (UUID в Go), сторона; не ИИН — не совпало; дальше сверка без расшифровки и без аудита.
        const userId = req.userId ?? "";
        const side = req.side ?? SigningSide.UNSPECIFIED;
        if (userId === "" || (side !== SigningSide.CLIENT && side !== SigningSide.EXECUTOR)) throw codedError("invalid_request", Code.InvalidArgument);
        const iin = req.iin ?? "";
        if (!isValidIin(iin)) return create(VerifySignerIinResponseSchema, { matches: false });
        let stored = "";
        if (side === SigningSide.CLIENT) stored = this.persons.get(userId)?.iin ?? "";
        else {
          const party = this.parties.get(userId);
          stored = !party ? "" : party.legalForm === LegalForm.TOO ? party.signerIin : party.binIin;
        }
        return create(VerifySignerIinResponseSchema, { matches: stored !== "" && stored === iin });
      }),
      revealPartyDetails: reading("revealPartyDetails", async (req: MessageInitShape<typeof RevealPartyDetailsRequestSchema>) => {
        // Порядок Go (reveal.go): цель, ссылка, список субъектов, сессия действующего лица; дальше чтение и аудит.
        const purpose = REVEAL_PURPOSES[req.purpose ?? RevealPurpose.UNSPECIFIED];
        if (!purpose) throw codedError("reveal_purpose_invalid", Code.InvalidArgument);
        const ref = req.referenceId ?? "";
        if (ref === "" || ref.length > MAX_REFERENCE_ID) throw codedError("invalid_request", Code.InvalidArgument);
        const raw = req.userIds ?? [];
        if (raw.length === 0 || raw.length > MAX_REVEAL_USERS || raw.some((id) => id === "")) throw codedError("invalid_request", Code.InvalidArgument);
        let actorRole = Role.UNSPECIFIED;
        if (req.actorSessionToken) {
          const { session } = await this.sessionOf(req.actorSessionToken);
          if (session.activeRole === Role.OPERATOR && !session.mfaVerifiedAt) throw codedError("mfa_required", Code.PermissionDenied);
          actorRole = session.activeRole;
        }
        const parties: PartyDetails[] = [];
        for (const id of new Set(raw)) {
          const details = this.partyDetails(id);
          if (details) parties.push(details);
          const after = { purpose, reference_id: ref, fields: details ? revealedFields(details) : [], found: details !== undefined };
          this.auditEvents.push({ userId: id, actorRole, action: "pii.revealed", after });
        }
        return create(RevealPartyDetailsResponseSchema, { parties });
      }),
      submitKyc: (req: MessageInitShape<typeof SubmitKycRequestSchema>) => {
        let idFiles: string[] = [];
        let registrationFiles: string[] = [];
        return this.once(
          "submitKyc",
          SubmitKycRequestSchema,
          req,
          async () => {
            // Транзакция Go: сессия и роль заново, сторона, переход по таблице (условный UPDATE), аудит без значений.
            const { user, session } = await this.sessionOf(req.sessionToken ?? "");
            if (session.activeRole !== Role.EXECUTOR) throw codedError("role_forbidden", Code.PermissionDenied);
            const p = this.parties.get(user.id);
            if (!p) throw codedError("party_missing", Code.FailedPrecondition);
            const before = p.kycStatus;
            p.kycStatus = kycTarget("submit", p);
            p.kycRejectReason = "";
            p.kycSubmittedAt = this.now();
            p.kycIdFileIds = idFiles;
            p.kycRegistrationFileIds = registrationFiles;
            this.auditEvents.push({
              userId: user.id,
              actorRole: Role.EXECUTOR,
              action: "executor.kyc_submitted",
              before: kycAudit(before),
              after: kycAudit(KycStatus.PENDING, { idFiles: idFiles.length, registrationFiles: registrationFiles.length }),
            });
            return create(SubmitKycResponseSchema, { party: this.mustParty(user.id) });
          },
          // Порядок Go (kyc.go): ключ, файлы (invalid_request), оба вида (kyc_documents_missing), сессия, активная роль исполнителя.
          async () => {
            this.checkKey(req.idempotencyKey);
            idFiles = kycFileIds(req.idFileIds ?? []);
            registrationFiles = kycFileIds(req.registrationFileIds ?? []);
            if (idFiles.length === 0 || registrationFiles.length === 0) throw codedError("kyc_documents_missing", Code.FailedPrecondition);
            if ((await this.sessionOf(req.sessionToken ?? "")).session.activeRole !== Role.EXECUTOR) throw codedError("role_forbidden", Code.PermissionDenied);
          },
        );
      },
      listKycQueue: reading("listKycQueue", async (req: MessageInitShape<typeof ListKycQueueRequestSchema>) => {
        // Порядок Go: сессия, оператор со второй ступенью; очередь — PENDING с обоими видами файлов, давно ждущие первыми.
        const { session } = await this.sessionOf(req.sessionToken ?? "");
        this.operatorWithMfa(session);
        const submitted = (p: StoredParty) => p.kycSubmittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
        const queue = [...this.parties.entries()]
          .filter(([, p]) => p.kycStatus === KycStatus.PENDING && p.kycIdFileIds.length > 0 && p.kycRegistrationFileIds.length > 0)
          .sort(([a, p], [b, q]) => submitted(p) - submitted(q) || (a < b ? -1 : a > b ? 1 : 0))
          .map(([userId]) => userId);
        return create(ListKycQueueResponseSchema, { parties: queue.map((id) => this.mustParty(id)), people: queue.map((id) => this.personOf(id)) });
      }),
      reviewKyc: (req: MessageInitShape<typeof ReviewKycRequestSchema>) => {
        let reason = "";
        let expected = 0n;
        return this.once(
          "reviewKyc",
          ReviewKycRequestSchema,
          req,
          async () => {
            // Транзакция Go: сессия и вторая ступень заново, сторона, переход только из PENDING (второе решение — отказ), аудит.
            const { session } = await this.sessionOf(req.sessionToken ?? "");
            this.operatorWithMfa(session);
            const userId = req.userId ?? "";
            const p = this.parties.get(userId);
            if (!p) throw codedError("party_missing", Code.FailedPrecondition);
            const before = p.kycStatus;
            const to = kycTarget(req.verify ? "verify" : "reject", p);
            // Условный UPDATE Go: kyc_submitted_at = expected_submitted_at (с точностью до микросекунд базы); подача
            // заменена после открытия очереди — kyc_transition_forbidden, без изменений.
            if (!sameSubmission(p.kycSubmittedAt, expected)) throw codedError("kyc_transition_forbidden", Code.FailedPrecondition);
            p.kycStatus = to;
            p.kycRejectReason = reason;
            p.kycReviewedAt = this.now();
            this.auditEvents.push({
              userId,
              actorRole: Role.OPERATOR,
              action: to === KycStatus.VERIFIED ? "executor.kyc_verified" : "executor.kyc_rejected",
              before: kycAudit(before),
              after: kycAudit(to, { reason }),
            });
            return create(ReviewKycResponseSchema, { party: this.mustParty(userId) });
          },
          // Порядок Go: ключ, пользователь (UUID в Go), время подачи, причина отказа (kyc_reason_invalid), сессия, оператор со
          // второй ступенью.
          async () => {
            this.checkKey(req.idempotencyKey);
            if (!req.userId) throw codedError("invalid_request", Code.InvalidArgument);
            expected = timestampMicros(req.expectedSubmittedAt);
            if (!req.verify) {
              reason = (req.reason ?? "").trim();
              if (reason.length < KYC_REASON_MIN || reason.length > KYC_REASON_MAX) throw codedError("kyc_reason_invalid", Code.InvalidArgument);
            }
            this.operatorWithMfa((await this.sessionOf(req.sessionToken ?? "")).session);
          },
        );
      },
      grantConsent: (req: MessageInitShape<typeof GrantConsentRequestSchema>) => {
        let kind = ConsentKind.UNSPECIFIED;
        let sum = "";
        let purposes: string[] = [];
        return this.once(
          "grantConsent",
          GrantConsentRequestSchema,
          req,
          async () => {
            // Транзакция Go: сессия заново; действующее той же версии и предмета — та же запись (другой хэш — отказ).
            const { user, session } = await this.sessionOf(req.sessionToken ?? "");
            const version = req.version ?? "";
            const ref = req.referenceId ?? "";
            const existing = this.activeConsents(user.id, kind).find((c) => c.version === version && c.referenceId === ref);
            if (existing) {
              if (existing.textSha256 !== sum) throw codedError("consent_version_invalid", Code.InvalidArgument);
              return create(GrantConsentResponseSchema, { consent: consentView(existing) });
            }
            const c = this.insertConsent({ userId: user.id, kind, version, textSha256: sum, purposes, referenceId: ref, channel: "otp_session" });
            this.auditEvents.push({ userId: user.id, actorRole: session.activeRole, action: "consent.granted", after: { kind: ConsentKind[kind], version, reference_id: ref, channel: c.channel } });
            return create(GrantConsentResponseSchema, { consent: consentView(c) });
          },
          // Порядок Go (consent.go): ключ, вид, версия и хэш, предмет, цели, сессия; дальше повтор по ключу.
          async () => {
            this.checkKey(req.idempotencyKey);
            if (!consentKindOk(req.kind)) throw codedError("invalid_request", Code.InvalidArgument);
            kind = req.kind;
            sum = consentProof(req.version ?? "", req.textSha256 ?? "");
            if (!validConsentReference(kind, req.referenceId ?? "")) throw codedError("invalid_request", Code.InvalidArgument);
            purposes = consentPurposes(req.purposes ?? []);
            await this.lookup(req.sessionToken ?? "");
          },
        );
      },
      revokeConsent: mutating(
        "revokeConsent",
        RevokeConsentRequestSchema,
        async (req) => {
          // Транзакция Go: действующего нет — consent_missing; открытая заявка — та же; иначе новая со сроком. Согласие
          // остаётся действующим до решения оператора (Ruling P).
          const { user, session } = await this.sessionOf(req.sessionToken ?? "");
          const active = this.activeConsents(user.id, ConsentKind.PD_PROCESSING);
          if (active.length === 0) throw codedError("consent_missing", Code.FailedPrecondition);
          const open = this.revocations.find((r) => r.userId === user.id && r.kind === ConsentKind.PD_PROCESSING && r.status === RevocationStatus.REQUESTED);
          if (open) return create(RevokeConsentResponseSchema, { revocation: revocationView(open) });
          const now = this.now();
          const rev: StoredRevocation = { id: randomUUID(), userId: user.id, kind: ConsentKind.PD_PROCESSING, requestedAt: now, dueAt: fakeRevocationDue(now), status: RevocationStatus.REQUESTED, decidedAt: null, reason: "" };
          this.revocations.push(rev);
          this.auditEvents.push({
            userId: user.id,
            actorRole: session.activeRole,
            action: "consent.revocation_requested",
            after: { kind: "PD_PROCESSING", versions: active.map((c) => c.version), revocation_id: rev.id, status: "REQUESTED", due_at: rev.dueAt.toISOString() },
          });
          return create(RevokeConsentResponseSchema, { revocation: revocationView(rev) });
        },
        // Порядок Go: ключ, вид (invalid_request), только ПДн (consent_not_revocable), сессия.
        async (req) => {
          this.checkKey(req.idempotencyKey);
          if (!consentKindOk(req.kind)) throw codedError("invalid_request", Code.InvalidArgument);
          if (req.kind !== ConsentKind.PD_PROCESSING) throw codedError("consent_not_revocable", Code.FailedPrecondition);
          await this.lookup(req.sessionToken ?? "");
        },
      ),
      listMyConsents: reading("listMyConsents", async (req: MessageInitShape<typeof ListMyConsentsRequestSchema>) => {
        // Все согласия с отозванными (старые первыми) и заявки (новые первыми).
        const { user } = await this.sessionOf(req.sessionToken ?? "");
        const consents = this.consents.filter((c) => c.userId === user.id).sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime() || (a.id < b.id ? -1 : 1));
        const revocations = this.revocations
          .filter((r) => r.userId === user.id)
          .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime() || (a.id < b.id ? -1 : 1));
        return create(ListMyConsentsResponseSchema, { consents: consents.map(consentView), revocations: revocations.map(revocationView) });
      }),
      hasConsents: reading("hasConsents", async (req: MessageInitShape<typeof HasConsentsRequestSchema>) => {
        // Порядок Go: вид и предмет, затем список 1–200 (id в Go — UUID); ответ — в порядке запроса без повторов.
        const kind = req.kind;
        if (!consentKindOk(kind) || !validConsentReference(kind, req.referenceId ?? "")) throw codedError("invalid_request", Code.InvalidArgument);
        const raw = req.userIds ?? [];
        if (raw.length === 0 || raw.length > MAX_HAS_CONSENTS_USERS || raw.some((id) => id === "")) throw codedError("invalid_request", Code.InvalidArgument);
        const granted = [...new Set(raw)].filter((id) => this.activeConsents(id, kind).some((c) => c.referenceId === (req.referenceId ?? "")));
        return create(HasConsentsResponseSchema, { grantedUserIds: granted });
      }),
      listConsentRevocations: reading("listConsentRevocations", async (req: MessageInitShape<typeof ListConsentRevocationsRequestSchema>) => {
        // Порядок Go: сессия, оператор со второй ступенью; открытые заявки, ближний срок первым; people — в том же порядке.
        const { session } = await this.sessionOf(req.sessionToken ?? "");
        this.operatorWithMfa(session);
        const open = this.revocations
          .filter((r) => r.status === RevocationStatus.REQUESTED)
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.requestedAt.getTime() - b.requestedAt.getTime() || (a.id < b.id ? -1 : 1));
        return create(ListConsentRevocationsResponseSchema, { revocations: open.map(revocationView), people: open.map((r) => this.personOf(r.userId)) });
      }),
      resolveConsentRevocation: (req: MessageInitShape<typeof ResolveConsentRevocationRequestSchema>) => {
        let reason = "";
        const decide = (session: StoredSession) => {
          if (session.activeRole !== Role.OPERATOR) throw codedError("role_forbidden", Code.PermissionDenied);
          if (!session.mfaVerifiedAt) throw codedError("mfa_required", Code.PermissionDenied);
        };
        return this.once(
          "resolveConsentRevocation",
          ResolveConsentRevocationRequestSchema,
          req,
          async () => {
            // Транзакция Go: сессия и решающий заново; условный переход из REQUESTED (иначе и для неизвестной — revocation_closed).
            const { user, session } = await this.sessionOf(req.sessionToken ?? "");
            decide(session);
            const rev = this.revocations.find((r) => r.id === req.revocationId && r.status === RevocationStatus.REQUESTED);
            if (!rev) throw codedError("revocation_closed", Code.FailedPrecondition);
            const now = this.now();
            rev.status = req.completed ? RevocationStatus.COMPLETED : RevocationStatus.REFUSED;
            rev.decidedAt = now;
            rev.reason = reason;
            const revoked: StoredConsent[] = [];
            if (req.completed) {
              for (const c of this.activeConsents(rev.userId, rev.kind)) {
                if (c.grantedAt.getTime() > rev.requestedAt.getTime()) continue; // данное заново после заявки остаётся
                c.revokedAt = now;
                revoked.push(c);
              }
            }
            this.auditEvents.push({
              userId: rev.userId,
              actorRole: Role.OPERATOR,
              action: req.completed ? "consent.revocation_completed" : "consent.revocation_refused",
              before: { kind: "PD_PROCESSING", revocation_id: rev.id, status: "REQUESTED" },
              after: { kind: "PD_PROCESSING", revocation_id: rev.id, status: RevocationStatus[rev.status], reason, ...(revoked.length > 0 && { versions: revoked.map((c) => c.version) }), decided_by: user.id },
            });
            return create(ResolveConsentRevocationResponseSchema, { revocation: revocationView(rev) });
          },
          // Порядок Go: ключ, id заявки (UUID), причина по переходу, сессия, оператор со второй ступенью.
          async () => {
            this.checkKey(req.idempotencyKey);
            const id = req.revocationId ?? "";
            if (id.length !== 36 || !UUID_RE.test(id)) throw codedError("invalid_request", Code.InvalidArgument);
            reason = revocationReason(req.completed ?? false, req.reason ?? "");
            decide((await this.sessionOf(req.sessionToken ?? "")).session);
          },
        );
      },
    };
  }
}

/** Единственный экземпляр на процесс тестов; `setup-integration.ts` подключает его и сбрасывает перед каждым тестом. */
export const identityFake = new FakeIdentity();
