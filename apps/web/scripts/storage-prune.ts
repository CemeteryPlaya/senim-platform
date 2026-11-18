// Ручная чистка локального хранилища стенда: APP_ENV=dev npm run storage:prune. Удаляет из STORAGE_LOCAL_DIR файлы, на
// которые не ссылается StoredFile базы DATABASE_URL (старше часа). Тот же код вызывает пересев стенда (prisma/seed.ts).
// При APP_ENV=prod и без явного APP_ENV — отказ (src/modules/files/prune.ts).
import "dotenv/config";
import { pruneLocalStorage } from "@/modules/files";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";

async function main() {
  const out = await pruneLocalStorage();
  switch (out.plan) {
    case "prune":
      // База открыта только при чистке: при отказе (prod) соединения нет и env() не проверяется — закрывать нечего.
      await db.$disconnect();
      logger.info("storage.prune.done", { root: out.root, ...out.result, removedMb: Math.round(out.result.removedBytes / 1024 / 1024) });
      return;
    case "skip-not-local":
      logger.info("storage.prune.skipped: STORAGE_PROVIDER не local — локальную папку не чистим");
      return;
    case "refuse-prod":
      logger.error("storage.prune.refused", { hint: "Чистка хранилища запрещена при APP_ENV=prod" });
      process.exitCode = 1;
      return;
    case "refuse-no-app-env":
      logger.error("storage.prune.refused", { hint: "Только при явном APP_ENV=dev или APP_ENV=staging" });
      process.exitCode = 1;
      return;
  }
}

main().catch((e) => {
  logger.error("storage.prune.failed", { error: e });
  process.exitCode = 1;
});
