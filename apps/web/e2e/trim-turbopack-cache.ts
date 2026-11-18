// Запуск перед `next dev` e2e-сервера (команда в e2e/web-server.ts): npx tsx e2e/trim-turbopack-cache.ts <distDir>.
// Скрипт настройки, не рабочий код. Любая ошибка (и при загрузке модулей) не мешает старту сервера: выход всегда с кодом 0.
async function main() {
  const distDir = process.argv[2] ?? ".next-e2e";
  const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
  const { logger } = await import("../src/platform/logger");
  try {
    const { TURBOPACK_CACHE_LIMIT_BYTES, trimTurbopackDevCache } = await import("./turbopack-cache");
    const { removed, bytes } = await trimTurbopackDevCache(distDir);
    if (removed) logger.warn("e2e.turbopack_cache.removed", { distDir, sizeGb: gb(bytes), limitGb: gb(TURBOPACK_CACHE_LIMIT_BYTES) });
  } catch (error) {
    logger.warn("e2e.turbopack_cache.check_failed", { distDir, error });
  }
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exitCode = 0;
  });
