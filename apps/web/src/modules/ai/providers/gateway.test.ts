import { MockImageModelV4, MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createGatewayProvider } from "./gateway";

const answer = {
  furnitureTypeSlug: "kitchen",
  customType: null,
  style: "loft",
  widthCm: 300,
  heightCm: null,
  depthCm: null,
  facade: "veneer",
  countertop: null,
  hardware: null,
  color: null,
  unknown: [],
  wishes: "",
};

function textModel(text: string) {
  const calls: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 40, text: 40, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

function imageModel(supportsFileInputs = true) {
  const calls: { files: unknown; prompt: string | undefined }[] = [];
  const model = new MockImageModelV4({
    supportsFileInputs,
    doGenerate: async (options) => {
      calls.push({ files: options.files, prompt: options.prompt });
      return {
        images: [PNG_1PX],
        warnings: [],
        response: { timestamp: new Date(0), modelId: "vendor/image", headers: undefined },
      };
    },
  });
  return { model, calls };
}

const furnitureTypes = [{ slug: "kitchen", name: "Кухня" }];

describe("gateway-провайдер на AI SDK (модели подменены моками SDK, без сети)", () => {
  it("structureRequest отдаёт ответ модели как raw и учёт токенов", async () => {
    const text = textModel(JSON.stringify(answer));
    const provider = createGatewayProvider({ textModel: text.model, textModelId: "vendor/text", imageModel: imageModel().model, imageModelId: "vendor/image" });
    const result = await provider.structureRequest({ text: "кухня лофт 3 м, шпон", furnitureTypes });
    expect(result.raw).toEqual(answer);
    expect(result.usage).toEqual({ model: "vendor/text", inputTokens: 120, outputTokens: 40 });
    expect(JSON.stringify(text.calls[0])).toContain("кухня лофт 3 м, шпон");
    expect(JSON.stringify(text.calls[0])).toContain("kitchen");
  });

  it("кривой ответ модели не роняет вызов: raw для проверки сервисом, учёт сохранён", async () => {
    const text = textModel("извините, не могу");
    const provider = createGatewayProvider({ textModel: text.model, textModelId: "vendor/text", imageModel: imageModel().model, imageModelId: "vendor/image" });
    const result = await provider.structureRequest({ text: "что-то", furnitureTypes });
    expect(result.raw).toBe("извините, не могу");
    expect(result.usage.inputTokens).toBe(120);
  });

  it("visualizeRoom передаёт фото как исходное изображение и возвращает картинку", async () => {
    const image = imageModel();
    const provider = createGatewayProvider({ textModel: textModel("{}").model, textModelId: "vendor/text", imageModel: image.model, imageModelId: "vendor/image" });
    const result = await provider.visualizeRoom({ image: PNG_1PX, contentType: "image/png", prompt: "светлая кухня" });
    expect(result.images).toEqual([{ data: PNG_1PX, contentType: "image/png" }]);
    expect(result.usage).toEqual({ model: "vendor/image", images: 1 });
    expect(image.calls[0].files).toHaveLength(1);
    expect(image.calls[0].prompt).toContain("светлая кухня");
  });

  it("зависший ответ шлюза прерывается по пределу времени — и для текста, и для картинки", async () => {
    // Модель отвечает только на отмену: без предела вызов висел бы бесконечно.
    const hang = (options: { abortSignal?: AbortSignal }) =>
      new Promise<never>((_, reject) => options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason)));
    const provider = createGatewayProvider({
      textModel: new MockLanguageModelV4({ doGenerate: hang }),
      textModelId: "vendor/text",
      imageModel: new MockImageModelV4({ supportsFileInputs: true, doGenerate: hang }),
      imageModelId: "vendor/image",
      timeoutMs: 50,
    });
    await expect(provider.structureRequest({ text: "кухня", furnitureTypes })).rejects.toThrow();
    await expect(provider.visualizeRoom({ image: PNG_1PX, contentType: "image/png", prompt: "" })).rejects.toThrow();
  });

  it("модель без поддержки исходного изображения — сервис недоступен, а не картинка «из воздуха»", async () => {
    const provider = createGatewayProvider({ textModel: textModel("{}").model, textModelId: "vendor/text", imageModel: imageModel(false).model, imageModelId: "vendor/image" });
    await expect(provider.visualizeRoom({ image: PNG_1PX, contentType: "image/png", prompt: "" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
