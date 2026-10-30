import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

export { Prisma };
export type Tx = Prisma.TransactionClient;
/** Клиент или транзакция: сервисы принимают любой из них. */
export type Db = PrismaClient | Tx;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

/** Ленивый клиент: соединение создаётся при первом запросе, а не при импорте (сборка без БД). */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    globalForPrisma.prisma ??= createClient();
    const value = Reflect.get(globalForPrisma.prisma, prop);
    return typeof value === "function" ? value.bind(globalForPrisma.prisma) : value;
  },
});

/** Транзакция с уровнем изоляции по умолчанию (READ COMMITTED) и разумными таймаутами. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { maxWait: 5_000, timeout: 15_000 });
}
