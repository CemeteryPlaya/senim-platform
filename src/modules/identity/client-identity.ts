import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db, isUniqueViolation, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { isValidIin } from "./kz-id";
import { actorOf, type CurrentUser } from "./session";

const t = ru.identity.clientIdentity;

/** ФИО и ИИН заказчика — сторона договора. При входе по SMS их нет: заказчик указывает их перед договором. */
export async function hasClientIdentity(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { fullName: true, iinLast4: true } });
  return Boolean(u?.fullName && u.iinLast4);
}

/**
 * Записывает ФИО и ИИН заказчика в транзакции вызывающего (requests.agreeToContract).
 * ИИН — только зашифрованным, с HMAC для уникальности; уже записанные данные не перезаписываются.
 * Уже есть ФИО и ИИН — ничего не делает (повторное согласие).
 */
export async function recordClientIdentity(tx: Tx, user: CurrentUser, input: { fullName: string; iin: string } | undefined): Promise<void> {
  const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, iinLast4: true } });
  if (current.fullName && current.iinLast4) return;
  if (!input) return fail.validation(t.required);
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length < 5 || !fullName.includes(" ")) return fail.validation(t.fullNameInvalid, { fieldErrors: { fullName: [t.fullNameInvalid] } });
  if (!isValidIin(input.iin)) return fail.validation(t.iinInvalid, { fieldErrors: { iin: [t.iinInvalid] } });

  const iinHash = hashPii(input.iin);
  const taken = await tx.user.findUnique({ where: { iinHash }, select: { id: true } });
  if (taken && taken.id !== user.id) return fail.conflict(t.iinTaken);

  // Уже указанное ФИО не меняем — только дополняем ИИН.
  const data = { fullName: current.fullName ?? fullName, iinEnc: encryptPii(input.iin), iinHash, iinLast4: last4(input.iin) };
  try {
    expectOneUpdated(await tx.user.updateMany({ where: { id: user.id, iinHash: null }, data }));
  } catch (e) {
    // Тот же ИИН одновременно в другом аккаунте: проверку выше прошли оба, сработал уникальный индекс.
    if (isUniqueViolation(e)) return fail.conflict(t.iinTaken);
    throw e;
  }
  await recordAudit(tx, { actor: actorOf(user), action: "user.identity.recorded", entity: { type: "user", id: user.id } });
}
