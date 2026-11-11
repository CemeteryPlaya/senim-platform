import "server-only";
import { LegalForm as ProtoLegalForm, RevealPurpose, SigningSide } from "@/gen/senim/identity/v1/identity_pb";
import type { LegalForm } from "@/generated/prisma/enums";
import { db, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { legalFormFromProto } from "./projection";
import { identity } from "./remote";
import { retriedOnce } from "./remote-errors";
import { currentSessionToken, type CurrentUser } from "./session";

/**
 * Открытые ПДн сторон сделки из identity (RevealPartyDetails) — единственный путь к полным ИИН, БИН и IBAN в web: договор,
 * расписка на раскрытие, выплата мастеру и «сертификат» mock-ЭЦП. Значения не логировать и не показывать в интерфейсе.
 *
 * identity раскрывает любого пользователя любому вызову web, поэтому права проверяет web до вызова: раскрываются только
 * стороны сделки `referenceId` (заказчик и исполнитель), действующее лицо — её сторона или оператор. Действующее лицо
 * указывается всегда: пользователь передаёт свою сессию (у оператора identity требует пройденный второй фактор и пишет его
 * в аудит pii.revealed); "system" — действует сам web (`service:web`), только на системных путях без пользователя.
 */
export type RevealPurposeName = "CONTRACT" | "RELEASE_RECEIPT" | "PAYOUT";

/** Открытые реквизиты человека и его стороны; null — не указано. */
export type PartyDetails = {
  userId: string;
  fullName: string | null;
  iin: string | null;
  legalForm: LegalForm | null;
  legalName: string | null;
  binIin: string | null;
  signerFullName: string | null;
  signerIin: string | null;
  payoutIban: string | null;
};

const PURPOSE: Record<RevealPurposeName, RevealPurpose> = {
  CONTRACT: RevealPurpose.CONTRACT,
  RELEASE_RECEIPT: RevealPurpose.RELEASE_RECEIPT,
  PAYOUT: RevealPurpose.PAYOUT,
};

const orNull = (s: string) => (s === "" ? null : s);

/** Стороны сделки (id пользователей заказчика и исполнителя); нет сделки — пусто. */
async function dealParties(client: Db, dealId: string): Promise<Set<string>> {
  const deal = await client.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executor: { select: { userId: true } } } });
  return new Set(deal ? [deal.clientId, deal.executor.userId] : []);
}

/**
 * Кто раскрывает: пользователь (его сессия уходит в identity) или "system" — сам web без пользователя (выпуск оферты
 * системой в createDeal, «сертификат» mock-подписи после проверки подписанта, фоновая выплата). Обязателен: пропущенное
 * действующее лицо не должно молча становиться service:web на пути пользователя.
 */
export type RevealActor = CurrentUser | "system";

/**
 * Раскрыть реквизиты сторон сделки `referenceId` для цели `purpose`. Пользователь, которого identity не знает, в ответ не
 * попадает. `client` — транзакция, в которой создана сделка (оферта выпускается в транзакции createDeal); по умолчанию — `db`.
 * Не сторона сделки среди `userIds`, действующее лицо не сторона и не оператор, сделки нет — FORBIDDEN без вызова identity.
 */
export async function revealParties(
  userIds: string[],
  purpose: RevealPurposeName,
  referenceId: string,
  actor: RevealActor,
  client: Db = db,
): Promise<Map<string, PartyDetails>> {
  const parties = await dealParties(client, referenceId);
  const user = actor === "system" ? null : actor;
  const allowedActor = !user || user.role === "OPERATOR" || parties.has(user.id);
  if (userIds.length === 0 || !userIds.every((id) => parties.has(id)) || !allowedActor) {
    logger.warn("identity.reveal_refused", { purpose, referenceId, actorId: user?.id ?? "system" });
    return fail.forbidden();
  }
  const actorSessionToken = user ? await currentSessionToken() : "";
  const request = { actorSessionToken, userIds, purpose: PURPOSE[purpose], referenceId };
  const res = await retriedOnce(() => identity().revealPartyDetails(request));
  const out = new Map<string, PartyDetails>();
  for (const p of res.parties) {
    if (!userIds.includes(p.userId)) {
      logger.error("identity.call_rejected", { reason: "reveal_of_other_user" });
      return fail.unavailable();
    }
    out.set(p.userId, {
      userId: p.userId,
      fullName: orNull(p.fullName),
      iin: orNull(p.iin),
      legalForm: p.legalForm === ProtoLegalForm.UNSPECIFIED ? null : legalFormFromProto(p.legalForm),
      legalName: orNull(p.legalName),
      binIin: orNull(p.binIin),
      signerFullName: orNull(p.signerFullName),
      signerIin: orNull(p.signerIin),
      payoutIban: orNull(p.payoutIban),
    });
  }
  return out;
}

/** За какую сторону сделки подписывают документ ЭЦП. */
export type SigningSideName = "CLIENT" | "EXECUTOR";

/**
 * Совпадает ли ИИН сертификата ЭЦП с подписантом пользователя на стороне `side` (VerifySignerIin): заказчик — ИИН личности,
 * исполнитель — директор ТОО или ИИН стороны ИП и самозанятого. identity сверяет слепые индексы и отвечает только да/нет.
 */
export async function verifySignerIin(userId: string, iin: string, side: SigningSideName): Promise<boolean> {
  const request = { userId, iin, side: side === "CLIENT" ? SigningSide.CLIENT : SigningSide.EXECUTOR };
  const res = await retriedOnce(() => identity().verifySignerIin(request));
  return res.matches;
}
