// Локальный запуск фоновых задач: npm run jobs (один проход) или npm run jobs -- --watch.
import "dotenv/config";
import { drainJobs, enqueueDailyJobs } from "@/jobs";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";

const watch = process.argv.includes("--watch");

async function once() {
  await enqueueDailyJobs();
  // Один проход — как cron: очередь разбирается целиком (в пределах бюджета), а не по 25 задач.
  const summary = await drainJobs();
  logger.info("jobs.run", summary);
}

async function main() {
  await once();
  while (watch) {
    await new Promise((r) => setTimeout(r, 10_000));
    await once();
  }
}

main()
  .catch((e) => {
    logger.error("jobs.crashed", { error: e });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
