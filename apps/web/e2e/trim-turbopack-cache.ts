// Запуск перед `next dev` e2e-сервера (команда в e2e/web-server.ts): npx tsx e2e/trim-turbopack-cache.ts <distDir>.
// Скрипт настройки, не рабочий код: сообщение — через logger, ошибка не мешает старту сервера.
import { logger } from "../src/platform/logger";
import { TURBOPACK_CACHE_LIMIT_BYTES, trimTurbopackDevCache } from "./turbopack-cache";

const distDir = process.argv[2] ?? ".next-e2e";
const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

trimTurbopackDevCache(distDir)
  .then(({ removed, bytes }) => {
    if (removed) logger.warn("e2e.turbopack_cache.removed", { distDir, sizeGb: gb(bytes), limitGb: gb(TURBOPACK_CACHE_LIMIT_BYTES) });
  })
  .catch((error: unknown) => logger.warn("e2e.turbopack_cache.check_failed", { distDir, error }));
