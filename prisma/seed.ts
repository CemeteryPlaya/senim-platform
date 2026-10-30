// Демо-данные: npm run db:seed. Только тестовые ИИН и телефоны.
import "dotenv/config";
import { db } from "../src/platform/db";
import { logger } from "../src/platform/logger";
import { DEFAULT_FURNITURE_TYPES } from "../src/verticals/furniture/catalog";

async function main() {
  for (const [i, t] of DEFAULT_FURNITURE_TYPES.entries()) {
    await db.furnitureType.upsert({ where: { slug: t.slug }, create: { ...t, sortOrder: i }, update: {} });
  }
  logger.info("seed.done");
}

main()
  .catch((e) => {
    logger.error("seed.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
