import { afterAll, beforeEach } from "vitest";
import { TEST_DATABASE_URL } from "./db-url";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const { db } = await import("@/platform/db");
const { resetEnvCache } = await import("@/platform/env");
resetEnvCache();

/** Перед каждым тестом — пустая база. TRUNCATE не вызывает триггер журнала аудита. */
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.$disconnect();
});
