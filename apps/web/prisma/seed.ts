// Данные стенда: npm run db:seed. Только тестовые ИИН, телефоны и адреса (src/seed/data.ts).
// Что делать — решает seedPlan (src/seed/plan.ts): пустая база вне prod — заполняется; непустая — пересоздаётся (сброс
// стенда в identity и TRUNCATE) только при явном APP_ENV dev или staging; при prod данные стенда не пишутся никогда.
// С флагом --if-empty (сборка на Vercel, `vercel-build`) непустая база не трогается, а при prod сид пропускается.
import "dotenv/config";
import { isDatabaseEmpty, reseedStand, seedStand } from "../src/seed/seed";
import { pruneLocalStorage } from "../src/modules/files";
import { seedPlan } from "../src/seed/plan";
import { db } from "../src/platform/db";
import { logger } from "../src/platform/logger";

async function main() {
  const plan = seedPlan({ appEnv: process.env.APP_ENV, empty: await isDatabaseEmpty(db), ifEmpty: process.argv.includes("--if-empty") });
  switch (plan) {
    case "seed":
      logger.info("seed.done", await seedStand(db));
      return;
    case "reseed": {
      logger.info("seed.reset", await reseedStand(db));
      // Файлы прежних записей (TRUNCATE их не удаляет) — только local и только при явном dev/staging (prune.ts).
      const pruned = await pruneLocalStorage();
      logger.info("seed.storage_pruned", pruned.plan === "prune" ? pruned.result : { plan: pruned.plan });
      return;
    }
    case "skip-not-empty":
      logger.info("seed.skipped: база не пуста");
      return;
    case "skip-prod":
      logger.info("seed.skipped: APP_ENV=prod — данные стенда в рабочую базу не пишутся");
      return;
    case "refuse-prod":
      logger.error("seed.refused", { hint: "Сид стенда запрещён при APP_ENV=prod" });
      process.exitCode = 1;
      return;
    case "refuse-no-app-env":
      logger.error("seed.refused: база не пуста", { hint: "Пересев стенда — только при явном APP_ENV=dev или APP_ENV=staging" });
      process.exitCode = 1;
      return;
  }
}

main()
  .catch((e) => {
    logger.error("seed.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
