// Данные стенда: npm run db:seed. Только тестовые ИИН, телефоны и адреса (src/seed/data.ts).
// Что делать — решает seedPlan (src/seed/plan.ts): пустая база вне prod — заполняется; непустая — пересоздаётся (сброс
// стенда в identity и TRUNCATE) только при явном APP_ENV dev или staging; при prod данные стенда не пишутся никогда.
// С флагом --if-empty (сборка на Vercel, `vercel-build`) непустая база не трогается, а при prod сид пропускается.
import "dotenv/config";
import { isDatabaseEmpty, reseedStand, seedStand } from "../src/seed/seed";
import { markLocalStorageIfNew, pruneLocalStorage, pruneRefusalHint } from "../src/modules/files";
import { seedPlan } from "../src/seed/plan";
import { db } from "../src/platform/db";
import { logger } from "../src/platform/logger";

async function main() {
  const plan = seedPlan({ appEnv: process.env.APP_ENV, empty: await isDatabaseEmpty(db), ifEmpty: process.argv.includes("--if-empty") });
  switch (plan) {
    case "seed":
      await markStorage();
      logger.info("seed.done", await seedStand(db));
      return;
    case "reseed":
      await markStorage();
      logger.info("seed.reset", await reseedStand(db));
      await pruneStorage();
      return;
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

/**
 * Метка владельца папки хранилища (prune.ts) — до того, как сид положит в неё файлы: пишется только в новую или пустую
 * папку. Сбой не мешает сиду.
 */
async function markStorage() {
  try {
    if ((await markLocalStorageIfNew()) === "not-empty") {
      logger.warn("seed.storage_unmarked", { hint: "Папка хранилища не пуста и без метки базы — чистка файлов прежних записей будет пропущена" });
    }
  } catch (error) {
    logger.warn("seed.storage_mark_failed", { error });
  }
}

/** Файлы прежних записей (TRUNCATE их не удаляет) — только по метке своей базы (prune.ts). Чистка вторична: сбой не роняет пересев. */
async function pruneStorage() {
  try {
    const out = await pruneLocalStorage();
    if (out.plan === "prune") logger.info("seed.storage_pruned", out.result);
    else logger.warn("seed.storage_prune_skipped", { hint: pruneRefusalHint(out) });
  } catch (error) {
    logger.warn("seed.storage_prune_failed", { error });
  }
}

main()
  .catch((e) => {
    logger.error("seed.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
