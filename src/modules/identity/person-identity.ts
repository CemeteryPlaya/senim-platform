import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db, isUniqueViolation, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { enforceRateLimit } from "@/platform/rate-limit";
import { isValidFullName, normalizeFullName } from "./full-name";
import { isValidIin } from "./kz-id";
import { actorOf, type CurrentUser } from "./session";

const t = ru.identity.clientIdentity;
const IIN_ATTEMPTS = { limit: 5, windowSec: 3600 };

/** ФИО и ИИН человека, который подписывает договор ЭЦП. fullName: null — только ИИН (ИП: имя не спрашиваем). */
export type PersonIdentity = { fullName: string | null; iin: string };

/** Столбцы ИИН в записи пользователя: зашифрованный, HMAC для уникальности и поиска, последние 4 цифры для показа. */
export function iinColumns(iin: string) {
  return { iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) };
}

/** ФИО и ИИН заказчика — сторона договора. При входе по SMS их нет: заказчик указывает их перед договором. */
export async function hasClientIdentity(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { fullName: true, iinLast4: true } });
  return Boolean(u?.fullName && u.iinLast4);
}

/**
 * Записывает ФИО и ИИН подписанта в User в транзакции вызывающего: заказчик перед договором
 * (requests.agreeToContract), директор ТОО и владелец ИП при регистрации исполнителя.
 * ИИН — только зашифрованным, с HMAC; один ИИН — один аккаунт.
 *  - "fill": ИИН уже есть — ничего не делает (заказчик: после договора данные не меняются);
 *  - "replace": записывает поверх (регистрация: до подтверждения сделок нет, а директор в повторной анкете мог смениться).
 */
export async function recordPersonIdentity(tx: Tx, user: CurrentUser, input: PersonIdentity | undefined, mode: "fill" | "replace" = "fill"): Promise<void> {
  const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, iinHash: true } });
  if (mode === "fill" && current.iinHash) return;
  if (!input) return fail.validation(t.required);
  const fullName = input.fullName === null ? null : normalizeFullName(input.fullName);
  if (fullName !== null && !isValidFullName(fullName)) return fail.validation(t.fullNameInvalid, { fieldErrors: { fullName: [t.fullNameInvalid] } });
  if (!isValidIin(input.iin)) return fail.validation(t.iinInvalid, { fieldErrors: { iin: [t.iinInvalid] } });

  // Ответ «ИИН занят» говорит, что у человека с этим ИИН есть аккаунт: перебор ограничен.
  // Счётчик — вне транзакции вызывающего, поэтому откат после отказа его не сбрасывает.
  await enforceRateLimit(`identity:iin:user:${user.id}`, IIN_ATTEMPTS, t.tooMany);
  const columns = iinColumns(input.iin);
  const taken = await tx.user.findUnique({ where: { iinHash: columns.iinHash }, select: { id: true } });
  if (taken && taken.id !== user.id) return fail.conflict(t.iinTaken);

  // "fill" уже указанное ФИО не меняет — только дополняет ИИН; "replace" берёт новое, если оно есть.
  const data = { ...columns, fullName: mode === "fill" ? (current.fullName ?? fullName) : (fullName ?? current.fullName) };
  try {
    // Условие по прочитанному ИИН: параллельная запись между чтением и обновлением даст конфликт, а не перезапись.
    expectOneUpdated(await tx.user.updateMany({ where: { id: user.id, iinHash: current.iinHash }, data }));
  } catch (e) {
    // Тот же ИИН одновременно в другом аккаунте: проверку выше прошли оба, сработал уникальный индекс.
    if (isUniqueViolation(e)) return fail.conflict(t.iinTaken);
    throw e;
  }
  await recordAudit(tx, { actor: actorOf(user), action: "user.identity.recorded", entity: { type: "user", id: user.id } });
}
