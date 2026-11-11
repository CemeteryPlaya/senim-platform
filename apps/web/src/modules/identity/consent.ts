import "server-only";
import { randomUUID } from "node:crypto";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { ConsentKind, RevocationStatus, type ConsentRevocation } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { parseInput } from "@/platform/validation";
import { consentDocument, consentTextSha256, type ConsentKindName } from "./consent-text";
import { identity } from "./remote";
import { identityFailure, retriedOnce } from "./remote-errors";
import { currentSessionToken, type CurrentUser } from "./session";

/**
 * Согласия (правовое исследование A.2, A.7 P2/P3/P6/P7) — через identity: запись согласия (версия и SHA-256 показанного
 * текста, цели, канал — сессия входа по SMS), отзыв заявкой со сроком 15 рабочих дней, очередь отзывов оператора.
 * Текст — ru/consent.ts, версия и хэш — consent-text.ts. Отзыв только открывает заявку: согласие действует до решения
 * оператора (Ruling P); пока заявка открыта, «дать согласие заново» не предлагается (Ruling R).
 */

const KIND_PROTO: Record<ConsentKindName, ConsentKind> = {
  PD_PROCESSING: ConsentKind.PD_PROCESSING,
  BANK_TRANSFER: ConsentKind.BANK_TRANSFER,
};

/** Ответ identity без обязательного поля — сбой контракта: в лог, человеку — общий текст. */
function broken(reason: string): never {
  logger.error("identity.call_rejected", { reason });
  return fail.unavailable(ru.common.errors.generic);
}

const dateOf = (ts: Timestamp | undefined): Date | null => (ts ? timestampDate(ts) : null);

/**
 * GrantConsent текущей редакции текста вида в сессии этого браузера. Повтор после обрыва — с тем же ключом; identity
 * возвращает действующую запись той же версии без новой (двойной клик безопасен).
 */
async function grant(kind: ConsentKindName, referenceId: string): Promise<void> {
  const doc = consentDocument(kind);
  const request = {
    sessionToken: await currentSessionToken(),
    kind: KIND_PROTO[kind],
    version: doc.version,
    textSha256: consentTextSha256(kind),
    purposes: doc.purposes,
    referenceId,
    idempotencyKey: randomUUID(),
  };
  const res = await retriedOnce(() => identity().grantConsent(request));
  if (!res.consent) broken("grant_consent_without_consent");
}

/** Согласие на обработку ПДн текущей редакции (экран /consent) в сессии этого браузера; вход проверяет requireConsentSubject. */
export async function grantPdConsent(): Promise<void> {
  await grant("PD_PROCESSING", "");
}

/**
 * Согласие на передачу данных банку-партнёру к сделке в сессии этого браузера. Сторону сделки проверяет вызывающий
 * (deal-core.giveBankConsent): identity знает только id сделки.
 */
export async function grantBankConsent(dealId: string): Promise<void> {
  await grant("BANK_TRANSFER", dealId);
}

/**
 * Кто из пользователей дал согласие на передачу банку к сделке (HasConsents, чтение без сессии). Ответ — множество id
 * из запроса.
 */
export async function bankConsentsOf(dealId: string, userIds: string[]): Promise<Set<string>> {
  try {
    const res = await identity().hasConsents({ userIds, kind: ConsentKind.BANK_TRANSFER, referenceId: dealId });
    return new Set(res.grantedUserIds);
  } catch (e) {
    return identityFailure(e);
  }
}

export type RevocationStatusName = "REQUESTED" | "COMPLETED" | "REFUSED";

/** Заявка на отзыв для экранов: статус, когда подана, срок ответа, решение и причина отказа. */
export type RevocationView = {
  id: string;
  status: RevocationStatusName;
  requestedAt: Date;
  dueAt: Date;
  decidedAt: Date | null;
  reason: string | null;
};

const STATUS_NAME: Partial<Record<RevocationStatus, RevocationStatusName>> = {
  [RevocationStatus.REQUESTED]: "REQUESTED",
  [RevocationStatus.COMPLETED]: "COMPLETED",
  [RevocationStatus.REFUSED]: "REFUSED",
};

function revocationView(r: ConsentRevocation | undefined): RevocationView {
  const status = r && STATUS_NAME[r.status];
  const requestedAt = dateOf(r?.requestedAt);
  const dueAt = dateOf(r?.dueAt);
  if (!r || !status || !requestedAt || !dueAt) return broken("revocation_without_fields");
  return { id: r.id, status, requestedAt, dueAt, decidedAt: dateOf(r.decidedAt), reason: r.reason === "" ? null : r.reason };
}

/**
 * Отзыв согласия на обработку ПДн (P6): identity открывает заявку со сроком 15 рабочих дней; открытая уже есть — та же
 * заявка. Согласие действует до решения оператора (Ruling P), поэтому человек остаётся на «Моих данных», а не уходит на
 * экран согласия. Вход (requireUser) проверяет вызывающий.
 */
export async function revokePdConsent(): Promise<RevocationView> {
  const request = { sessionToken: await currentSessionToken(), kind: ConsentKind.PD_PROCESSING, idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().revokeConsent(request));
  return revocationView(res.revocation);
}

/** Действующее согласие для «Моих данных»: вид, редакция, когда дано и к какой сделке (передача банку). */
export type ActiveConsent = { id: string; kind: ConsentKindName; version: string; grantedAt: Date; dealId: string | null };

export type MyData = {
  phone: string;
  fullName: string | null;
  iinLast4: string | null;
  instagram: string | null;
  email: string | null;
  /** Действующие согласия: ПДн, затем передача банку по сделкам — в порядке выдачи. */
  consents: ActiveConsent[];
  /** Последняя заявка на отзыв согласия на ПДн (открытая или решённая); нет — null. */
  revocation: RevocationView | null;
};

const KIND_NAME: Partial<Record<ConsentKind, ConsentKindName>> = {
  [ConsentKind.PD_PROCESSING]: "PD_PROCESSING",
  [ConsentKind.BANK_TRANSFER]: "BANK_TRANSFER",
};

/**
 * «Мои данные» (P7, ст. 24): личность и контакты (GetProfile — ИИН последними 4 цифрами) и согласия с заявками
 * (ListMyConsents) из identity, телефон — из сессии.
 */
export async function getMyData(user: CurrentUser): Promise<MyData> {
  const sessionToken = await currentSessionToken();
  const [profile, consents] = await Promise.all([identity().getProfile({ sessionToken }), identity().listMyConsents({ sessionToken })]).catch((e: unknown) =>
    identityFailure(e),
  );
  const person = profile.person;
  const active: ActiveConsent[] = [];
  for (const c of consents.consents) {
    const kind = KIND_NAME[c.kind];
    const grantedAt = dateOf(c.grantedAt);
    if (!kind || !grantedAt) return broken("consent_without_fields");
    if (c.revokedAt) continue;
    active.push({ id: c.id, kind, version: c.version, grantedAt, dealId: kind === "BANK_TRANSFER" ? c.referenceId : null });
  }
  active.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "PD_PROCESSING" ? -1 : 1));
  const pd = consents.revocations.find((r) => r.kind === ConsentKind.PD_PROCESSING);
  return {
    phone: user.phone,
    fullName: person?.fullName || null,
    iinLast4: person?.iinLast4 || null,
    instagram: person?.instagram || null,
    email: person?.email || null,
    consents: active,
    revocation: pd ? revocationView(pd) : null,
  };
}

// ─── оператор ────────────────────────────────────────────────────────────────

export const REVOCATION_REASON_MIN = 3;
export const REVOCATION_REASON_MAX = 500;

const reasonText = ru.operator.consents.reasonLength(REVOCATION_REASON_MIN, REVOCATION_REASON_MAX);

/**
 * Решение оператора по заявке на отзыв: COMPLETED — без причины (identity иначе откажет invalid_request), REFUSED — с
 * причиной 3–500 символов после обрезки пробелов (то же правило, что у отказа KYC и в identity).
 */
export const revocationDecisionSchema = z
  .object({
    revocationId: z.guid(),
    decision: z.enum(["COMPLETED", "REFUSED"]),
    reason: z.string().trim().max(REVOCATION_REASON_MAX, reasonText).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "REFUSED" && (v.reason ?? "").length < REVOCATION_REASON_MIN) ctx.addIssue({ code: "custom", path: ["reason"], message: reasonText });
  });
export type RevocationDecision = z.input<typeof revocationDecisionSchema>;

export type RevocationQueueItem = RevocationView & { userId: string; fullName: string | null; iinLast4: string | null };

function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/**
 * Очередь отзывов (ListConsentRevocations): открытые заявки, ближний срок первым — порядок identity; ФИО и последние 4
 * цифры ИИН — из identity. Нужна сессия оператора с пройденной второй ступенью (иначе MFA_REQUIRED).
 */
export async function consentRevocationQueue(operator: CurrentUser): Promise<RevocationQueueItem[]> {
  requireOperator(operator);
  const sessionToken = await currentSessionToken();
  let res;
  try {
    res = await identity().listConsentRevocations({ sessionToken });
  } catch (e) {
    return identityFailure(e);
  }
  return res.revocations.map((r, i) => {
    const person = res.people[i];
    return { ...revocationView(r), userId: r.userId, fullName: person?.fullName || null, iinLast4: person?.iinLast4 || null };
  });
}

/**
 * Решение по заявке (ResolveConsentRevocation): исполнить — identity отмечает отозванными согласия, данные не позже
 * заявки; отказать — согласие остаётся. Условный переход в identity: двойной клик и второй оператор дают одно решение,
 * остальным — CONFLICT «заявка уже рассмотрена».
 */
export async function resolveConsentRevocation(operator: CurrentUser, raw: RevocationDecision): Promise<RevocationView> {
  requireOperator(operator);
  const input = parseInput(revocationDecisionSchema, raw);
  const completed = input.decision === "COMPLETED";
  const request = {
    sessionToken: await currentSessionToken(),
    revocationId: input.revocationId,
    completed,
    reason: completed ? "" : (input.reason ?? ""),
    idempotencyKey: randomUUID(),
  };
  const res = await retriedOnce(() => identity().resolveConsentRevocation(request));
  return revocationView(res.revocation);
}
