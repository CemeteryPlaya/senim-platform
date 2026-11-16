// Данные стенда: npm run db:seed. Только тестовые ИИН, телефоны и адреса (src/seed/data.ts).
// Пустая база — заполняется. Непустая — пересоздаётся (сброс стенда в identity и TRUNCATE) только при APP_ENV не prod,
// иначе ошибка; identity и сам отказывает в сбросе и сиде при prod (stand_disabled) — до TRUNCATE.
// С флагом --if-empty (сборка на Vercel, `vercel-build`) непустая база не трогается: деплой не стирает данные стенда.
import "dotenv/config";
import { isDatabaseEmpty, reseedStand, seedStand } from "../src/seed/seed";
import { db } from "../src/platform/db";
import { env } from "../src/platform/env";
import { logger } from "../src/platform/logger";

const onlyIfEmpty = process.argv.includes("--if-empty");

async function main() {
  if (await isDatabaseEmpty(db)) {
    logger.info("seed.done", await seedStand(db));
    return;
  }
  if (onlyIfEmpty) {
    logger.info("seed.skipped: база не пуста");
    return;
  }
  if (env().APP_ENV === "prod") {
    logger.error("seed.refused: база не пуста", { hint: "Пересев стенда запрещён при APP_ENV=prod" });
    process.exitCode = 1;
    return;
  }
  logger.info("seed.reset", await reseedStand(db));
}

main()
  .catch((e) => {
    logger.error("seed.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
