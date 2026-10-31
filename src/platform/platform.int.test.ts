import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
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

  it("в lastError и в журнал не попадают ИИН, телефон и аргументы запроса Prisma", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const prisma = new Prisma.PrismaClientKnownRequestError("Unique constraint failed: phone +77001234567", { code: "P2002", clientVersion: "7" });
    await enqueueJob(db, { kind: "test.pii", maxAttempts: 2, dedupeKey: "pii" });
    await enqueueJob(db, { kind: "test.prisma", maxAttempts: 1, dedupeKey: "prisma" });
    const handlers = {
      "test.pii": async () => Promise.reject(new Error("ИИН 900101300123, телефон 8 700 123 45 67, заявка 42")),
      "test.prisma": async () => Promise.reject(prisma),
    };

    expect(await runDueJobs(handlers)).toMatchObject({ retried: 1, failed: 1 });

    const pii = await db.job.findFirstOrThrow({ where: { kind: "test.pii" } });
    expect(pii.lastError).toBe("ИИН [скрыто], телефон [скрыто], заявка 42");
    expect((await db.job.findFirstOrThrow({ where: { kind: "test.prisma" } })).lastError).toBe("PrismaClientKnownRequestError P2002");
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/заявка 42/);
    expect(logged).not.toMatch(/900101300123|123 45 67|7001234567|Unique constraint/);
    vi.restoreAllMocks();
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
