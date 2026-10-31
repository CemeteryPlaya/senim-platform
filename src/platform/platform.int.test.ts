import { describe, expect, it } from "vitest";
import { recordAudit, scopeHistory, SYSTEM } from "@/modules/audit";
import { db } from "@/platform/db";
import { enqueueJob, runDueJobs } from "@/platform/jobs";
import { hitRateLimit } from "@/platform/rate-limit";
import { decryptPii, encryptPii, hashPii } from "@/platform/crypto";

describe("журнал аудита", () => {
  it("хранит историю корня по порядку", async () => {
    for (const action of ["deal.created", "deal.signed"]) {
      await recordAudit(db, { actor: SYSTEM("test"), action, entity: { type: "deal", id: "d1" }, scope: "deal:d1" });
    }
    expect((await scopeHistory("deal:d1")).map((e) => e.action)).toEqual(["deal.created", "deal.signed"]);
  });

  it("запрещает изменение и удаление записей на уровне БД", async () => {
    await recordAudit(db, { actor: SYSTEM("test"), action: "x.done", entity: { type: "x", id: "1" } });
    await expect(db.auditEvent.updateMany({ data: { action: "x.forged" } })).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.deleteMany()).rejects.toThrow(/append-only/);
  });
});

describe("фоновые задачи", () => {
  it("не создаёт дубль по dedupeKey и выполняет задачу один раз", async () => {
    const calls: unknown[] = [];
    await enqueueJob(db, { kind: "test.echo", payload: { n: 1 }, dedupeKey: "echo-1" });
    await enqueueJob(db, { kind: "test.echo", payload: { n: 1 }, dedupeKey: "echo-1" });

    const summary = await runDueJobs({ "test.echo": async (p) => void calls.push(p) });

    expect(summary).toMatchObject({ claimed: 1, done: 1 });
    expect(calls).toEqual([{ n: 1 }]);
    expect(await runDueJobs({ "test.echo": async (p) => void calls.push(p) })).toMatchObject({ claimed: 0 });
  });

  it("откладывает упавшую задачу на повтор, а после последней попытки помечает FAILED", async () => {
    await enqueueJob(db, { kind: "test.boom", maxAttempts: 2 });
    const boom = { "test.boom": async () => Promise.reject(new Error("сбой")) };

    expect(await runDueJobs(boom)).toMatchObject({ retried: 1 });
    await db.job.updateMany({ data: { runAt: new Date(0) } });
    expect(await runDueJobs(boom)).toMatchObject({ failed: 1 });
    expect((await db.job.findFirstOrThrow()).status).toBe("FAILED");
  });

  it("после дедлайна задача не берётся и остаётся в очереди", async () => {
    await enqueueJob(db, { kind: "test.echo", dedupeKey: "late" });
    const calls: unknown[] = [];
    const now = Date.now();
    expect(await runDueJobs({ "test.echo": async (p) => void calls.push(p) }, { deadline: now - 1, clock: () => now })).toMatchObject({ claimed: 0 });
    expect(calls).toEqual([]);
    expect((await db.job.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("задача без обработчика сразу FAILED", async () => {
    await enqueueJob(db, { kind: "test.unknown" });
    expect(await runDueJobs({})).toMatchObject({ failed: 1 });
  });
});

describe("лимит частоты", () => {
  it("пропускает limit попыток в окне и блокирует следующую", async () => {
    const rule = { limit: 3, windowSec: 60 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await hitRateLimit("otp:+77000000001", rule)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });

  it("параллельные попытки считаются атомарно", async () => {
    const rule = { limit: 5, windowSec: 60 };
    const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit("login:ip", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe("шифрование ИИН", () => {
  it("расшифровывает зашифрованное и даёт стабильный хэш для поиска", () => {
    const sealed = encryptPii("900101300123");
    expect(sealed).not.toContain("900101300123");
    expect(decryptPii(sealed)).toBe("900101300123");
    expect(hashPii("900101300123")).toBe(hashPii("900101300123"));
  });
});
