import { beforeEach, describe, expect, it } from "vitest";
import { makeClient, makeExecutor } from "../../../test/factories";
import { makeKitchenType, makeRequest, useAiEnv } from "../../../test/factories/ai";
import { db } from "@/platform/db";
import { assistRequest } from "./assist";
import { costUsdMicros } from "./pricing";
import type { AiProvider, StructureRequestInput } from "./provider";
import { mockProvider } from "./providers/mock";

const TEXT = "Нужна кухня 3,2 м, высота 2,7 м, фасады МДФ эмаль, фурнитура Blum, цвет белый";

/** Провайдер-шпион: запоминает, что ему передали, и отвечает заданным. */
function spyProvider(answer?: Partial<Awaited<ReturnType<AiProvider["structureRequest"]>>>) {
  const seen: StructureRequestInput[] = [];
  const provider: AiProvider = {
    name: "mock",
    async structureRequest(input) {
      seen.push(input);
      const base = await mockProvider.structureRequest(input);
      return { ...base, ...answer };
    },
    visualizeRoom: mockProvider.visualizeRoom,
  };
  return { deps: { provider: () => provider }, seen };
}

beforeEach(async () => {
  await useAiEnv();
  await makeKitchenType();
});

describe("assistRequest — «Опишите своими словами»", () => {
  it("разбирает текст в поля заявки, подсказывает сегмент и пишет учёт", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);

    const result = await assistRequest(client, request.id, TEXT);

    expect(result.draft).toMatchObject({
      furnitureTypeSlug: "kitchen",
      details: { widthCm: 320, heightCm: 270, facade: "mdf_enamel", hardware: "premium", color: "Белый" },
    });
    expect(result.segment.segment).toBe("PREMIUM");
    expect(result.segment.reasons.length).toBeGreaterThan(0);

    const usage = await db.aiUsage.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: "mock",
      operation: "request.assist",
      model: "mock/text",
      requestId: request.id,
      userId: client.id,
      costUsdMicros: 0,
    });
    expect(usage[0].inputTokens).toBeGreaterThan(0);
  });

  it("персональные данные вычищаются до вызова провайдера", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);
    const spy = spyProvider();

    const result = await assistRequest(
      client,
      request.id,
      "Меня зовут Айгерим Сапарова, тел +7 701 234 56 78, aigerim@mail.kz, ул. Абая, д. 12, кв. 5. Нужна кухня",
      spy.deps,
    );

    const sent = spy.seen[0].text;
    expect(sent).not.toMatch(/Айгерим|Сапарова|701|aigerim|Абая/);
    expect(sent).toContain("[телефон]");
    expect(result.draft.furnitureTypeSlug).toBe("kitchen");
  });

  it("кривой ответ провайдера отклоняется, а потраченное всё равно учтено", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);
    const spy = spyProvider({ raw: { furnitureTypeSlug: "kitchen", widthCm: "три метра" } });

    await expect(assistRequest(client, request.id, TEXT, spy.deps)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.aiUsage.count()).toBe(1);
  });

  it("стоимость считается по таблице цен для модели провайдера", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);
    const usage = { model: "vendor/text-model", inputTokens: 1_200, outputTokens: 300 };
    const spy = spyProvider({ usage });

    await assistRequest(client, request.id, TEXT, spy.deps);

    const row = await db.aiUsage.findFirstOrThrow();
    expect(row).toMatchObject({ model: "vendor/text-model", inputTokens: 1_200, outputTokens: 300 });
    expect(row.costUsdMicros).toBe(costUsdMicros(usage));
    expect(row.costUsdMicros).toBeGreaterThan(0);
  });

  it("сбой провайдера — понятная ошибка «недоступно»", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);
    const provider: AiProvider = {
      ...mockProvider,
      name: "gateway",
      structureRequest: async () => {
        throw new Error("ECONNRESET");
      },
    };
    await expect(assistRequest(client, request.id, TEXT, { provider: () => provider })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("чужая заявка недоступна, исполнителю помощник не положен", async () => {
    const owner = await makeClient();
    const other = await makeClient();
    const request = await makeRequest(owner);
    const executor = await makeExecutor();

    await expect(assistRequest(other, request.id, TEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assistRequest(executor, request.id, TEXT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.aiUsage.count()).toBe(0);
  });

  it("работает только с черновиком заявки", async () => {
    const client = await makeClient();
    const request = await makeRequest(client, "OPEN");
    await expect(assistRequest(client, request.id, TEXT)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("слишком короткий текст — ошибка ввода, провайдер не вызывается", async () => {
    const client = await makeClient();
    const request = await makeRequest(client);
    const spy = spyProvider();
    await expect(assistRequest(client, request.id, "  кух  ", spy.deps)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(spy.seen).toHaveLength(0);
  });

  it("при AI_ENABLED=false — «недоступно», провайдер не вызывается и учёт пуст", async () => {
    await useAiEnv({ AI_ENABLED: "false" });
    const client = await makeClient();
    const request = await makeRequest(client);
    const spy = spyProvider();

    await expect(assistRequest(client, request.id, TEXT, spy.deps)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(spy.seen).toHaveLength(0);
    expect(await db.aiUsage.count()).toBe(0);
  });
});
