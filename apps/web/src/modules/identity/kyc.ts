import "server-only";
import { randomUUID } from "node:crypto";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import type { Party } from "@/gen/senim/identity/v1/identity_pb";
import type { LegalForm } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { attachFiles, fileUrl } from "@/modules/files";
import { notify } from "@/modules/notifications";
import { db, transaction, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { parseInput } from "@/platform/validation";
import { ownExecutorId } from "./executor-guard";
import { KYC_MAX_FILES, KYC_REASON_MAX, KYC_REASON_MIN, kycView, type KycState } from "./kyc-policy";
import { legalFormFromProto, ownParty, projectParty } from "./projection";
import { identity } from "./remote";
import { identityFailure, isCodedRefusal, retriedOnce } from "./remote-errors";
import { actorOf, currentSessionToken, type CurrentUser } from "./session";

export { KYC_MAX_FILES, KYC_REASON_MAX, KYC_REASON_MIN };

/** Назначения файлов KYC (files.PURPOSE_POLICY): удостоверение и регистрация ИП/ТОО. */
export type KycPurpose = "KYC_ID" | "KYC_REGISTRATION";

/**
 * KYC мастера (решение 2.2.8) — через identity: статус, переходы и журнал ведёт identity (SubmitKyc, ListKycQueue,
 * ReviewKyc), в ExecutorProfile — проекция. Файлы хранит web (модуль files): владельца и назначение проверяет web до
 * вызова identity, identity получает только их id. Уведомления — web. Документы прежних подач остаются прикреплёнными к
 * профилю в web (история); на проверке — только файлы последней подачи из identity.
 */
/** Ссылки на документы в очереди оператора живут недолго: это удостоверения личности. */
const DOC_URL_TTL_SEC = 15 * 60;

const t = ru.identity.kyc;
/** id пользователя identity — UUID (ReviewKyc иного не примет). */
const userIdField = z.guid();
/**
 * id файла: SubmitKyc принимает только UUID. Файлы, загруженные до перехода на UUID (cuid), — понятный текст «загрузите
 * заново», а не общий сбой после вызова identity.
 */
const fileId = z.guid(t.errors.reupload);

export const kycSubmitSchema = z.object({
  idFileIds: z.array(fileId).min(1, t.errors.needId).max(KYC_MAX_FILES),
  registrationFileIds: z.array(fileId).min(1, t.errors.needRegistration).max(KYC_MAX_FILES),
});
export type KycSubmitInput = z.input<typeof kycSubmitSchema>;

const reasonText = t.reasonLength(KYC_REASON_MIN, KYC_REASON_MAX);
const decisionFields = {
  decision: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().trim().max(KYC_REASON_MAX, reasonText).optional(),
};
/** Причина обязательна при отказе (3–500 символов после trim); при подтверждении не передаётся. */
const reasonRequired = (v: { decision: "VERIFIED" | "REJECTED"; reason?: string }, ctx: z.RefinementCtx) => {
  if (v.decision === "REJECTED" && (v.reason ?? "").length < KYC_REASON_MIN) ctx.addIssue({ code: "custom", path: ["reason"], message: reasonText });
};
export const kycDecisionSchema = z.object(decisionFields).superRefine(reasonRequired);
export type KycDecision = z.input<typeof kycDecisionSchema>;
/** Форма оператора: пользователь-исполнитель (id в identity) и решение. */
export const kycReviewSchema = z.object({ userId: userIdField, ...decisionFields }).superRefine(reasonRequired);
export type KycReviewInput = z.input<typeof kycReviewSchema>;

/** Сторона своего профиля из identity (GetProfile в сессии этого браузера), с записью в проекцию. */
async function ownKycParty(user: CurrentUser): Promise<Party> {
  const sessionToken = await currentSessionToken();
  let res;
  try {
    res = await identity().getProfile({ sessionToken });
  } catch (e) {
    return identityFailure(e);
  }
  const party = ownParty(user.id, res.party);
  await projectParty(party);
  return party;
}

export type OwnKyc = { state: KycState; canSubmit: boolean; rejectReason: string | null; documents: { id: number; registration: number } };

/** Экран мастера «Проверка документов»: состояние из identity, причина отказа, сколько файлов в последней подаче. */
export async function getOwnKyc(user: CurrentUser): Promise<OwnKyc> {
  ownExecutorId(user);
  const party = await ownKycParty(user);
  const view = kycView(party.kycStatus);
  return {
    ...view,
    rejectReason: view.state === "REJECTED" && party.kycRejectReason !== "" ? party.kycRejectReason : null,
    documents: { id: party.kycIdFileIds.length, registration: party.kycRegistrationFileIds.length },
  };
}

/**
 * Мастер отправляет документы на проверку. Порядок: web прикрепляет файлы к своему профилю (свои, ещё не прикреплённые,
 * нужного назначения — attachFiles; иначе CONFLICT, identity не вызывается; двойной клик даёт отказ второму), затем
 * SubmitKyc с их id (переход решает identity: проверенные документы не заменяются), затем проекция и уведомление
 * операторов. Обрыв связи — один повтор с тем же ключом. Прикрепление снимается (те же файлы можно отправить снова), только
 * если identity ответил кодом контракта и ни одна попытка до этого не оборвалась: тогда он точно ничего не записал. Обрыв,
 * дедлайн, Internal без кода (сброс потока после коммита) — исход неизвестен: identity мог записать id файлов, и файлы
 * остаются прикреплёнными (иначе очередь оператора не нашла бы их в web).
 */
export async function submitKycDocuments(user: CurrentUser, raw: KycSubmitInput): Promise<void> {
  const executorId = ownExecutorId(user);
  const input = parseInput(kycSubmitSchema, raw);
  const idFileIds = [...new Set(input.idFileIds)];
  const registrationFileIds = [...new Set(input.registrationFileIds)];
  const sessionToken = await currentSessionToken();

  const owner = { executorProfileId: executorId };
  await transaction(async (tx) => {
    await attachFiles(tx, { fileIds: idFileIds, uploadedById: user.id, owner, purpose: "KYC_ID" });
    await attachFiles(tx, { fileIds: registrationFileIds, uploadedById: user.id, owner, purpose: "KYC_REGISTRATION" });
  });

  const request = { sessionToken, idFileIds, registrationFileIds, idempotencyKey: randomUUID() };
  let uncertain = false; // какая-то попытка могла дойти до identity и записаться
  let refused = false; // последняя попытка — отказ с кодом контракта
  const call = async () => {
    try {
      return await identity().submitKyc(request);
    } catch (e) {
      refused = isCodedRefusal(e);
      if (!refused) uncertain = true;
      throw e;
    }
  };
  let res;
  try {
    res = await retriedOnce(call, {
      kyc_transition_forbidden: () => fail.conflict(t.errors.alreadyVerified),
      party_missing: () => fail.conflict(t.errors.partyMissing),
    });
  } catch (e) {
    if (refused && !uncertain) {
      await db.storedFile.updateMany({
        where: { id: { in: [...idFileIds, ...registrationFileIds] }, executorProfileId: executorId },
        data: { executorProfileId: null },
      });
    }
    throw e;
  }
  const party = ownParty(user.id, res.party);
  await transaction(async (tx) => {
    await projectParty(party, tx);
    const { legalName } = await tx.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: { legalName: true } });
    const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
    for (const op of operators) {
      await notify(tx, { userId: op.id, kind: "kyc.submitted", title: t.notifyOperator.title, body: t.notifyOperator.body(legalName), link: "/operator/kyc" });
    }
  });
}

export type KycDocument = { id: string; purpose: KycPurpose; contentType: string; createdAt: Date; url: string };
export type KycQueueItem = {
  /** Профиль в web (ссылки на карточку исполнителя). */
  executorId: string;
  /** Пользователь в identity: решение оператора — по нему. */
  userId: string;
  publicNumber: number;
  legalForm: LegalForm;
  legalName: string;
  binIinLast4: string;
  /** ФИО человека из identity — сверить с удостоверением; нет — null. */
  fullName: string | null;
  /** Документы последней подачи: удостоверение, затем регистрация. */
  documents: KycDocument[];
  /**
   * Оба вида документов нашлись в web — решение принимать можно. Нет — часть id из identity не сходится с файлами профиля:
   * экран показывает пометку вместо формы решения.
   */
  complete: boolean;
  submittedAt: Date | null;
};

function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/** ListKycQueue в сессии оператора (identity требует пройденную вторую ступень — иначе MFA_REQUIRED). */
async function listKycQueue() {
  const sessionToken = await currentSessionToken();
  try {
    return await identity().listKycQueue({ sessionToken });
  } catch (e) {
    return identityFailure(e);
  }
}

/** Сколько мастеров ждут проверки — для панели оператора: без ссылок на документы и без записей о выдаче. */
export async function kycQueueCount(operator: CurrentUser): Promise<number> {
  requireOperator(operator);
  return (await listKycQueue()).parties.length;
}

type QueueFile = { id: string; purpose: string; contentType: string; createdAt: Date; provider: string; storageKey: string; executorProfileId: string | null };

/**
 * Документы стороны для оператора: файлы из identity, но только те, что в web прикреплены к профилю этого исполнителя с
 * тем же назначением (identity хранит лишь id). Расхождение — в лог без значений, ссылка не выдаётся.
 */
async function documentsOf(party: Party, executorId: string, files: Map<string, QueueFile>): Promise<KycDocument[]> {
  const wanted: [string, KycPurpose][] = [
    ...party.kycIdFileIds.map((fileId) => [fileId, "KYC_ID"] as [string, KycPurpose]),
    ...party.kycRegistrationFileIds.map((fileId) => [fileId, "KYC_REGISTRATION"] as [string, KycPurpose]),
  ];
  const documents: KycDocument[] = [];
  for (const [fileId, purpose] of wanted) {
    const file = files.get(fileId);
    if (!file || file.executorProfileId !== executorId || file.purpose !== purpose) {
      logger.error("identity.kyc_queue.file_mismatch", { executorId, found: file !== undefined });
      continue;
    }
    documents.push({ id: file.id, purpose, contentType: file.contentType, createdAt: file.createdAt, url: await fileUrl(file, { expiresInSec: DOC_URL_TTL_SEC }) });
  }
  return documents;
}

/**
 * Очередь проверки (ListKycQueue): мастера на проверке с обоими видами документов, давно ждущие первыми — порядок
 * identity. Ссылки на файлы выдаются здесь, после проверки роли (ADR-003: право — при выдаче ссылки), живут 15 минут;
 * каждая выданная ссылка — событие аудита web `pii.kyc_file_link_issued` (какой файл, кому; ни ссылки, ни ПДн).
 * Записи пишутся до того, как ссылки уйдут на экран: не записалось — ссылок нет.
 */
export async function kycQueue(operator: CurrentUser): Promise<KycQueueItem[]> {
  requireOperator(operator);
  const res = await listKycQueue();
  const userIds = res.parties.map((p) => p.userId);
  const people = new Map(res.people.map((p) => [p.userId, p]));
  const profiles = new Map(
    (await db.executorProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true, publicNumber: true } })).map((p) => [p.userId, p]),
  );
  const fileIds = res.parties.flatMap((p) => [...p.kycIdFileIds, ...p.kycRegistrationFileIds]);
  const files = new Map(
    (
      await db.storedFile.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, purpose: true, contentType: true, createdAt: true, provider: true, storageKey: true, executorProfileId: true },
      })
    ).map((f) => [f.id, f]),
  );

  const items: KycQueueItem[] = [];
  for (const party of res.parties) {
    const profile = profiles.get(party.userId);
    if (!profile) {
      logger.error("identity.kyc_queue.profile_missing", { userId: party.userId });
      continue;
    }
    const documents = await documentsOf(party, profile.id, files);
    const complete = (["KYC_ID", "KYC_REGISTRATION"] as const).every((purpose) => documents.some((d) => d.purpose === purpose));
    if (!complete) logger.error("identity.kyc_queue.incomplete", { executorId: profile.id });
    items.push({
      executorId: profile.id,
      userId: party.userId,
      publicNumber: profile.publicNumber,
      legalForm: legalFormFromProto(party.legalForm),
      legalName: party.legalName,
      binIinLast4: party.binIinLast4,
      fullName: people.get(party.userId)?.fullName || null,
      documents,
      complete,
      submittedAt: party.kycSubmittedAt ? timestampDate(party.kycSubmittedAt) : null,
    });
  }
  await recordLinksIssued(operator, items);
  return items;
}

async function recordLinksIssued(operator: CurrentUser, items: KycQueueItem[]): Promise<void> {
  if (items.every((i) => i.documents.length === 0)) return;
  await transaction(async (tx: Db) => {
    for (const item of items) {
      for (const doc of item.documents) {
        await recordAudit(tx, {
          actor: actorOf(operator),
          action: "pii.kyc_file_link_issued",
          entity: { type: "file", id: doc.id },
          scope: `executor:${item.executorId}`,
          meta: { purpose: doc.purpose, expiresInSec: DOC_URL_TTL_SEC },
        });
      }
    }
  });
}

/**
 * Решение оператора (ReviewKyc → проекция → уведомление мастеру): VERIFIED или REJECTED с причиной (3–500 символов).
 * Переход и журнал — в identity (условный переход: двойной клик и два оператора дают одно решение, второму — CONFLICT
 * «уже рассмотрены»); уведомление — только после принятого решения.
 */
export async function reviewKyc(operator: CurrentUser, userId: string, decision: KycDecision): Promise<void> {
  requireOperator(operator);
  const target = parseInput(userIdField, userId);
  const input = parseInput(kycDecisionSchema, decision);
  const verify = input.decision === "VERIFIED";
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, userId: target, verify, reason: verify ? "" : (input.reason ?? ""), idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().reviewKyc(request), { party_missing: () => fail.notFound(t.errors.notFound) });
  const party = ownParty(target, res.party);
  await transaction(async (tx) => {
    await projectParty(party, tx);
    const n = t.notifyExecutor;
    await notify(
      tx,
      verify
        ? { userId: target, kind: "kyc.verified", title: n.verifiedTitle, body: n.verifiedBody, link: "/executor/profile/kyc" }
        : { userId: target, kind: "kyc.rejected", title: n.rejectedTitle, body: n.rejectedBody(party.kycRejectReason), link: "/executor/profile/kyc" },
    );
  });
}
