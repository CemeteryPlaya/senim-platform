import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { parseExecutorIdentityMode, type ExecutorIdentityMode } from "./display";

/**
 * Режим «имя исполнителя скрыто / показано» (ответ №6, ADR-006) — PlatformSetting, переключает оператор
 * в демо. Вне DEMO_MODE настройка не действует: заказчик видит «Исполнитель №N» (инвариант по умолчанию).
 */
export const EXECUTOR_IDENTITY_KEY = "companies.executorIdentity";

export async function getExecutorIdentityMode(client: Db = db): Promise<ExecutorIdentityMode> {
  if (!env().DEMO_MODE) return "HIDDEN";
  const row = await client.platformSetting.findUnique({ where: { key: EXECUTOR_IDENTITY_KEY } });
  return parseExecutorIdentityMode(row?.value);
}

/**
 * Переключатель оператора. Строка настройки блокируется (FOR UPDATE после upsert-вставки),
 * поэтому двойной клик даёт одну запись в журнале: второй вызов видит режим уже установленным.
 */
export async function setExecutorIdentityMode(operator: CurrentUser, mode: ExecutorIdentityMode): Promise<void> {
  if (operator.role !== "OPERATOR") fail.forbidden();
  if (!env().DEMO_MODE) fail.forbidden(ru.companies.identity.demoOnly);
  const next = parseExecutorIdentityMode(mode);
  await transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "PlatformSetting" ("key", "value", "updatedAt") VALUES (${EXECUTOR_IDENTITY_KEY}, '"HIDDEN"'::jsonb, now()) ON CONFLICT ("key") DO NOTHING`;
    const [row] = await tx.$queryRaw<{ value: unknown }[]>`SELECT "value" FROM "PlatformSetting" WHERE "key" = ${EXECUTOR_IDENTITY_KEY} FOR UPDATE`;
    const before = parseExecutorIdentityMode(row?.value);
    if (before === next) return;
    await tx.platformSetting.update({ where: { key: EXECUTOR_IDENTITY_KEY }, data: { value: next } });
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "companies.executor_identity.switched",
      entity: { type: "platformSetting", id: EXECUTOR_IDENTITY_KEY },
      before: { mode: before },
      after: { mode: next },
    });
  });
}
