// Демо-данные: npm run db:seed. Только тестовые ИИН, телефоны и адреса (src/demo/data.ts).
// Пустая база — заполняется. Непустая — пересоздаётся только при DEMO_MODE=true, иначе ошибка.
// С флагом --if-empty (сборка на Vercel, `vercel-build`) непустая база не трогается: деплой не стирает демо.
import "dotenv/config";
import { isDatabaseEmpty, resetDemo, seedDemo } from "../src/demo/seed";
import { db } from "../src/platform/db";
import { env } from "../src/platform/env";
import { logger } from "../src/platform/logger";

const onlyIfEmpty = process.argv.includes("--if-empty");

async function main() {
  if (await isDatabaseEmpty(db)) {
    logger.info("seed.done", await seedDemo(db));
    return;
  }
  if (onlyIfEmpty) {
    logger.info("seed.skipped: база не пуста");
    return;
  }
  if (!env().DEMO_MODE) {
    logger.error("seed.refused: база не пуста", { hint: "Сброс демо-данных разрешён только при DEMO_MODE=true" });
    process.exitCode = 1;
    return;
  }
  logger.info("seed.reset", await resetDemo(db));
}

main()
  .catch((e) => {
    logger.error("seed.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
