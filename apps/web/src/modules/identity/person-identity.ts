import "server-only";
import { randomUUID } from "node:crypto";
import { ru } from "@/i18n/ru";
import { db, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { ownPerson, projectPerson } from "./projection";
import { identity } from "./remote";
import { retriedOnce } from "./remote-errors";
import { currentSessionToken, type CurrentUser } from "./session";

const t = ru.identity.clientIdentity;

/** ФИО и ИИН заказчика — стороны договора, которая подписывает его своей ЭЦП. */
export type PersonIdentity = { fullName: string; iin: string };

/** ФИО и ИИН заказчика — сторона договора. При входе по SMS их нет: заказчик указывает их перед договором. */
export async function hasClientIdentity(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { fullName: true, iinLast4: true } });
  return Boolean(u?.fullName && u.iinLast4);
}

/**
 * Проверка в транзакции вызывающего (requests.agreeToContract): ФИО и ИИН стороны уже в проекции — иначе
 * VALIDATION «Укажите ФИО и ИИН». Записывает их recordPersonIdentity до транзакции.
 */
export async function requirePersonIdentity(tx: Tx, userId: string): Promise<void> {
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, iinLast4: true } });
  if (!(u.fullName && u.iinLast4)) fail.validation(t.required);
}

/**
 * ФИО и ИИН — в identity (RecordPerson в сессии этого браузера), ответ — в проекцию. Ключ идемпотентности — один на
 * попытку формы: обрыв связи повторяется с ним же, и identity отвечает тем же, а не вторым эффектом. Формат, «ИИН
 * занят», «уже указаны» и лимит попыток (5 в час) проверяет identity; отказы — тексты из `ru` у полей формы.
 */
async function recordPerson(user: Pick<CurrentUser, "id">, input: PersonIdentity): Promise<void> {
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, fullName: input.fullName, iin: input.iin, idempotencyKey: randomUUID() };
  const res = await retriedOnce(() => identity().recordPerson(request));
  await projectPerson(ownPerson(user.id, res.person));
}

/**
 * Знакомство (№26): ФИО и ИИН один раз сразу после первого входа. Уже указанные не меняются: тот же ИИН ещё раз —
 * тот же ответ (двойная отправка формы безопасна), другой — CONFLICT (смена — только оператором, OPEN_QUESTIONS №26).
 */
export async function recordOwnIdentity(user: CurrentUser, input: PersonIdentity): Promise<void> {
  await recordPerson(user, input);
}

/**
 * ФИО и ИИН заказчика перед договором (requests.agreeToContract) — ДО транзакции вызывающего: запись в identity нельзя
 * откатить вместе с ней, а повтор безопасен (тот же ИИН — тот же ответ). Уже указаны — ничего не делает: переданные
 * повторно данные не пишутся. Не указаны и не переданы — VALIDATION. Подписант исполнителя сюда не пишется — он
 * свойство профиля исполнителя (ADR-003).
 */
export async function recordPersonIdentity(user: CurrentUser, input: PersonIdentity | undefined): Promise<void> {
  if (await hasClientIdentity(user.id)) return;
  if (!input) return fail.validation(t.required);
  await recordPerson(user, input);
}
