import "server-only";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import type { Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { maskPublicText } from "./mask";

/** Исполнитель, действующий над своим профилем и портфолио. Подтверждения оператора не требуется: профиль заполняют до проверки. */
export function requireExecutor(user: CurrentUser): { executorId: string } {
  if (user.role !== "EXECUTOR" || !user.executor) return fail.forbidden(ru.companies.errors.executorOnly);
  return { executorId: user.executor.id };
}

/**
 * Публичный текст исполнителя без контактов, без наименования ТОО/ИП целиком (maskIdentity) и без отдельных
 * слов ФИО подписанта из профиля и владельца аккаунта (maskNameWords).
 */
export async function sanitizePublicText(client: Db, executorId: string, text: string): Promise<{ text: string; masked: boolean }> {
  const profile = await client.executorProfile.findUniqueOrThrow({
    where: { id: executorId },
    select: { legalForm: true, legalName: true, signerFullName: true, user: { select: { fullName: true } } },
  });
  return maskPublicText(text, profile);
}

/** Все переданные типы мебели существуют и включены оператором. */
export async function assertActiveFurnitureTypes(client: Db, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await client.furnitureType.count({ where: { id: { in: [...ids] }, active: true } });
  if (found !== ids.length) fail.validation(ru.companies.errors.unknownFurnitureType);
}
