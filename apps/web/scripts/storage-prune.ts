// Ручная чистка локального хранилища стенда: APP_ENV=dev npm run storage:prune. Удаляет из STORAGE_LOCAL_DIR файлы, на
// которые не ссылается StoredFile базы DATABASE_URL (старше часа), — только если метка папки (.senim-storage-db) совпадает
// с базой; метку команда не создаёт. Тот же код вызывает пересев стенда (prisma/seed.ts). При APP_ENV=prod, без явного
// APP_ENV, без метки и при чужой метке — отказ (src/modules/files/prune.ts).
import "dotenv/config";
import { pruneLocalStorage, pruneRefusalHint } from "@/modules/files";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";

async function main() {
  const out = await pruneLocalStorage();
  if (out.plan === "prune") {
    logger.info("storage.prune.done", { root: out.root, ...out.result, removedMb: Math.round(out.result.removedBytes / 1024 / 1024) });
    return;
  }
  if (out.plan === "skip-not-local") {
    logger.info("storage.prune.skipped", { hint: pruneRefusalHint(out) });
    return;
  }
  logger.error("storage.prune.refused", { hint: pruneRefusalHint(out) });
  process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error("storage.prune.failed", { error: e });
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.$disconnect();
    } catch {
      // Отказ при APP_ENV=prod: клиент базы не создавался, а env() с prod-проверками не проходит — закрывать нечего.
    }
  });
