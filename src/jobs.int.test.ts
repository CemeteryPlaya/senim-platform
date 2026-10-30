import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { enqueueJob } from "@/platform/jobs";
import { drainJobs, enqueueDailyJobs } from "./jobs";

const noop = { "test.noop": async () => {} };

async function enqueueMany(n: number) {
  for (let i = 0; i < n; i++) await enqueueJob(db, { kind: "test.noop", dedupeKey: `noop:${i}` });
}

describe("разбор очереди за один вызов cron", () => {
  it("проходы идут, пока очередь не пуста: 60 задач — больше одного прохода по 25", async () => {
    await enqueueMany(60);
    const summary = await drainJobs(noop, { budgetMs: 50_000 });
    expect(summary).toMatchObject({ claimed: 60, done: 60, failed: 0 });
    expect(summary.passes).toBeGreaterThan(2);
    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(0);
  });

  it("бюджет времени истёк — новый проход не начинается", async () => {
    await enqueueMany(30);
    let t = 0;
    const clock = () => (t += 60_000); // проход «занял» минуту
    const summary = await drainJobs(noop, { budgetMs: 50_000, clock });
    expect(summary).toMatchObject({ passes: 1, claimed: 25 });
    expect(await db.job.count({ where: { status: "PENDING" } })).toBe(5);
  });

  it("ежедневные задачи включают досылку зависших денежных операций", async () => {
    await enqueueDailyJobs(new Date("2026-10-31T10:00:00Z"));
    await enqueueDailyJobs(new Date("2026-10-31T18:00:00Z"));
    expect(await db.job.count({ where: { kind: "payments.resendPending" } })).toBe(1);
  });
});
