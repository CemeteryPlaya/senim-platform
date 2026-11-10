import { afterAll, beforeEach } from "vitest";
import { TEST_DATABASE_URL } from "./db-url";
import { identityFake } from "./stubs/identity";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { db } = await import("@/platform/db");
const { resetEnvCache } = await import("@/platform/env");
resetEnvCache();
const { setIdentityForTests } = await import("@/modules/identity/remote");
const { sha256Hex } = await import("@/platform/crypto");
const { roleToProto } = await import("@/modules/identity/projection");

/**
 * Сессии, созданные старым кодом входа (startSession пишет в таблицу Session), подделка identity находит в этой таблице:
 * до Task 13 такие тесты получают пользователя через cookie, как раньше. Блокировка, отзыв и срок действуют так же.
 */
identityFake.setFallbackSessions(async (token) => {
  const session = await db.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const { user } = session;
  return {
    user: { id: user.id, phone: user.phone, defaultRole: roleToProto(user.role), roles: user.roles.map(roleToProto), isDemo: user.isDemo, blocked: user.blockedAt !== null },
    activeRole: roleToProto(session.activeRole ?? user.role),
  };
});

/** Перед каждым тестом — пустая база. TRUNCATE не вызывает триггер журнала аудита. */
beforeEach(async () => {
  identityFake.reset();
  setIdentityForTests(identityFake.client);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.$disconnect();
});
