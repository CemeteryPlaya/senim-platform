import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { makeClient, makeOperator } from "../../../test/factories";
import { makeRequest, makeRoomPhoto, useAiEnv } from "../../../test/factories/ai";
import { storageByName } from "@/modules/files";
import { db } from "@/platform/db";
import { runDueJobs, type JobContext } from "@/platform/jobs";
import { logger } from "@/platform/logger";
import type { AiDeps } from "./deps";
import { LABEL_RGB } from "./label";
import type { AiProvider } from "./provider";
import { mockProvider } from "./providers/mock";
import {
  getVisualization,
  jobHandlers,
  listVisualizations,
  requestVisualization,
  runVisualization,
  VISUALIZE_ATTEMPTS,
  VISUALIZE_JOB,
} from "./visualize";

/** Расход ИИ всей платформы за последние сутки (по умолчанию бюджет AI_DAILY_BUDGET_USD = 20 $). */
const spendAi = (costUsdMicros: number, createdAt = new Date()) =>
  db.aiUsage.create({ data: { provider: "gateway", operation: "request.assist", costUsdMicros, createdAt } });

const ctx = (attempt = 1): JobContext => ({ jobId: "test", attempt, log: logger });

function deps(visualizeRoom: AiProvider["visualizeRoom"]): AiDeps {
  return { provider: () => ({ ...mockProvider, name: "gateway", visualizeRoom }) };
}

async function setup() {
  const client = await makeClient();
  const request = await makeRequest(client);
  const photo = await makeRoomPhoto(client, request.id);
  return { client, request, photo };
}

beforeEach(async () => {
  await useAiEnv({ AI_MAX_VISUALIZATIONS_PER_REQUEST: "2" });
});

describe("requestVisualization — постановка в очередь и лимит", () => {
  it("создаёт Visualization в очереди и задачу ai.visualize, ключ задачи — id визуализации", async () => {
    const { client, request, photo } = await setup();

    const view = await requestVisualization(client, request.id, photo.id, "светлая кухня, звоните 87011234567");

    expect(view).toMatchObject({ status: "QUEUED", results: [] });
    const viz = await db.visualization.findUniqueOrThrow({ where: { id: view.id } });
    expect(viz).toMatchObject({ requestId: request.id, sourceFileId: photo.id, status: "QUEUED" });
    expect(viz.prompt).not.toContain("87011234567");
    const jobs = await db.job.findMany({ where: { kind: VISUALIZE_JOB } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ dedupeKey: `${VISUALIZE_JOB}:${view.id}`, payload: { visualizationId: view.id } });
  });

  it("не больше AI_MAX_VISUALIZATIONS_PER_REQUEST на заявку", async () => {
    const { client, request, photo } = await setup();
    await requestVisualization(client, request.id, photo.id, "");
    await requestVisualization(client, request.id, photo.id, "");
    await expect(requestVisualization(client, request.id, photo.id, "")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await db.visualization.count()).toBe(2);
  });

  it("параллельные запросы не обходят лимит", async () => {
    const { client, request, photo } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => requestVisualization(client, request.id, photo.id, "")),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await db.visualization.count({ where: { requestId: request.id } })).toBe(2);
    expect(await db.job.count({ where: { kind: VISUALIZE_JOB } })).toBe(2);
  });

  it("неудачные иллюстрации не съедают лимит", async () => {
    const { client, request, photo } = await setup();
    const first = await requestVisualization(client, request.id, photo.id, "");
    await db.visualization.update({ where: { id: first.id }, data: { status: "FAILED" } });
    await requestVisualization(client, request.id, photo.id, "");
    await requestVisualization(client, request.id, photo.id, "");
    expect(await db.visualization.count({ where: { status: { not: "FAILED" } } })).toBe(2);
  });

  it("фото должно быть фото помещения этой заявки", async () => {
    const { client, request } = await setup();
    const otherRequest = await makeRequest(client);
    const foreignPhoto = await makeRoomPhoto(client, otherRequest.id);
    await expect(requestVisualization(client, request.id, foreignPhoto.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("чужая заявка — NOT_FOUND, оператор не заказывает иллюстрации", async () => {
    const { request, photo } = await setup();
    await expect(requestVisualization(await makeClient(), request.id, photo.id, "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requestVisualization(await makeOperator(), request.id, photo.id, "")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("при AI_ENABLED=false — «недоступно», ничего не создаётся", async () => {
    const { client, request, photo } = await setup();
    await useAiEnv({ AI_ENABLED: "false" });
    await expect(requestVisualization(client, request.id, photo.id, "")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(listVisualizations(client, request.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.visualization.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  });
});

describe("задача ai.visualize", () => {
  it("рисует иллюстрацию с пометкой, сохраняет файл ИИ и учёт", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "кухня шалфей");

    const summary = await runDueJobs(jobHandlers);
    expect(summary).toMatchObject({ claimed: 1, done: 1 });

    const done = await getVisualization(client, view.id);
    expect(done.status).toBe("DONE");
    expect(done.results).toHaveLength(1);
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: done.results[0].id } });
    expect(file).toMatchObject({ purpose: "VISUALIZATION", isAiGenerated: true, visualizationId: view.id });

    const bytes = await (await storageByName(file.provider)).get(file.storageKey);
    const { data, info } = await sharp(bytes!).raw().toBuffer({ resolveWithObject: true });
    const i = ((info.height - 3) * info.width + 3) * info.channels;
    const corner = [data[i], data[i + 1], data[i + 2]];
    corner.forEach((c, k) => expect(Math.abs(c - LABEL_RGB[k])).toBeLessThan(12)); // JPEG чуть сдвигает цвет

    const usage = await db.aiUsage.findMany({ where: { operation: "request.visualize" } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "mock", model: "mock/image", images: 1, requestId: request.id, userId: client.id });
  });

  it("испорченная задача — ошибка проверки (VALIDATION), а не сырой ZodError", async () => {
    await expect(runVisualization({ visualizationId: 42 }, ctx())).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("повторный запуск после успеха ничего не меняет", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    await runVisualization({ visualizationId: view.id }, ctx());
    await runVisualization({ visualizationId: view.id }, ctx(2));

    expect(await db.storedFile.count({ where: { visualizationId: view.id } })).toBe(1);
    expect(await db.aiUsage.count({ where: { operation: "request.visualize" } })).toBe(1);
  });

  it("два одновременных запуска дают один набор результатов", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    await Promise.all([runVisualization({ visualizationId: view.id }, ctx()), runVisualization({ visualizationId: view.id }, ctx())]);

    const viz = await db.visualization.findUniqueOrThrow({ where: { id: view.id } });
    expect(viz.status).toBe("DONE");
    expect(await db.storedFile.count({ where: { visualizationId: view.id } })).toBe(1);
  });

  it("сбой провайдера: повтор задачи, после последней попытки — FAILED без результатов", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    const broken = deps(async () => {
      throw new Error("gateway timeout");
    });

    await expect(runVisualization({ visualizationId: view.id }, ctx(1), broken)).rejects.toThrow("gateway timeout");
    expect((await db.visualization.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("RUNNING");

    await runVisualization({ visualizationId: view.id }, ctx(VISUALIZE_ATTEMPTS), broken);
    const failed = await getVisualization(client, view.id);
    expect(failed).toMatchObject({ status: "FAILED", results: [] });
    expect(failed.error).toBeTruthy();
  });

  it("стоимость изображений по таблице цен попадает в учёт и в визуализацию", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    const priced = deps(async (input) => {
      const r = await mockProvider.visualizeRoom(input);
      return { ...r, usage: { model: "vendor/image-model", images: 1 } };
    });
    await runVisualization({ visualizationId: view.id }, ctx(), priced);

    const usage = await db.aiUsage.findFirstOrThrow({ where: { operation: "request.visualize" } });
    expect(usage.costUsdMicros).toBeGreaterThan(0);
    const viz = await db.visualization.findUniqueOrThrow({ where: { id: view.id } });
    expect(viz.costUsdMicros).toBe(usage.costUsdMicros);
  });

  it("суточный бюджет ИИ платформы исчерпан — заказ отклонён, ждущая задача FAILED без вызова провайдера", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    await spendAi(20_000_000);

    await expect(requestVisualization(client, request.id, photo.id, "")).rejects.toMatchObject({ code: "UNAVAILABLE", message: expect.stringMatching(/завтра/) });
    let called = false;
    const spy = deps(async (input) => {
      called = true;
      return mockProvider.visualizeRoom(input);
    });
    await runVisualization({ visualizationId: view.id }, ctx(), spy);
    expect(called).toBe(false);
    expect(await db.visualization.findUniqueOrThrow({ where: { id: view.id } })).toMatchObject({ status: "FAILED", error: expect.stringMatching(/завтра/) });
  });

  it("если флаг выключили, пока задача ждала, — FAILED без вызова провайдера", async () => {
    const { client, request, photo } = await setup();
    const view = await requestVisualization(client, request.id, photo.id, "");
    await useAiEnv({ AI_ENABLED: "false" });
    let called = false;
    const spy = deps(async (input) => {
      called = true;
      return mockProvider.visualizeRoom(input);
    });
    await runVisualization({ visualizationId: view.id }, ctx(), spy);
    expect(called).toBe(false);
    expect((await db.visualization.findUniqueOrThrow({ where: { id: view.id } })).status).toBe("FAILED");
  });
});

describe("просмотр визуализаций", () => {
  it("заказчик и оператор видят статус и остаток лимита; чужой — нет", async () => {
    const { client, request, photo } = await setup();
    await requestVisualization(client, request.id, photo.id, "");

    const list = await listVisualizations(client, request.id);
    expect(list).toMatchObject({ limit: 2, remaining: 1 });
    expect(list.items).toHaveLength(1);
    expect((await listVisualizations(await makeOperator(), request.id)).items).toHaveLength(1);

    await expect(listVisualizations(await makeClient(), request.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getVisualization(await makeClient(), list.items[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
