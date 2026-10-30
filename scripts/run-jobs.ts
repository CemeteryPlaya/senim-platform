// Локальный запуск фоновых задач: npm run jobs (один проход) или npm run jobs -- --watch.
import "dotenv/config";
import { enqueueDailyJobs, jobHandlers } from "@/jobs";
import { db } from "@/platform/db";
import { runDueJobs } from "@/platform/jobs";
import { logger } from "@/platform/logger";

const watch = process.argv.includes("--watch");

async function once() {
  await enqueueDailyJobs();
  const summary = await runDueJobs(jobHandlers);
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
