import { generateImage, generateText, NoObjectGeneratedError, Output, type gateway } from "ai";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { COUNTERTOPS, FACADES, HARDWARE, STYLES } from "@/verticals/furniture";
import type { AiProvider, AiUsageInfo, StructureRequestInput } from "../provider";
import { requestDraftSuggestionSchema, SIZE_MAX_CM, SIZE_MIN_CM, WISHES_MAX } from "../schema";

/**
 * Реальный провайдер через пакет `ai` (AI SDK 7) и Vercel AI Gateway. Модели передаются
 * параметрами: в рабочем режиме — из createGateway (select.ts), в тестах — моки из `ai/test`.
 */

type TextModel = ReturnType<typeof gateway.languageModel>;
type ImageModel = ReturnType<typeof gateway.imageModel>;

export type GatewayProviderOptions = {
  textModel: TextModel;
  textModelId: string;
  imageModel: ImageModel;
  imageModelId: string;
  /** Предел одного вызова (с повтором SDK), мс. По умолчанию AI_CALL_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Предел вызова шлюза ИИ. Визуализация идёт фоновой задачей, а cron живёт 60 с: зависший ответ
 * не должен держать функцию до её убийства (задача тогда висела бы RUNNING до снятия блокировки).
 */
export const AI_CALL_TIMEOUT_MS = 40_000;

const list = (record: Record<string, { name: string }>) =>
  Object.entries(record)
    .map(([key, v]) => `${key} — ${v.name}`)
    .join("; ");

function systemPrompt(furnitureTypes: StructureRequestInput["furnitureTypes"]): string {
  return [
    "Ты помогаешь заказчику мебели на заказ заполнить заявку. Извлеки из текста только то, что заказчик сказал явно.",
    "Чего нет в тексте — null. Ничего не придумывай. Значения бери строго из списков ниже (ключи слева).",
    `furnitureTypeSlug: ${furnitureTypes.map((t) => `${t.slug} — ${t.name}`).join("; ")}. Если тип не из списка — null и customType: название своими словами.`,
    `style: ${list(STYLES)}.`,
    `facade: ${list(FACADES)}.`,
    `countertop: ${list(COUNTERTOPS)}.`,
    `hardware: ${list(HARDWARE)}.`,
    `widthCm, heightCm, depthCm — целые сантиметры от ${SIZE_MIN_CM} до ${SIZE_MAX_CM} (3,2 м = 320).`,
    "color — цвет и отделка словами заказчика, коротко.",
    "unknown — что заказчик прямо назвал неизвестным: size, facade, countertop, hardware.",
    `wishes — остальные пожелания одной-двумя фразами, не длиннее ${WISHES_MAX} символов, по-русски.`,
    "Метки вида [телефон], [адрес], [имя] — скрытые данные: не переноси их никуда.",
  ].join("\n");
}

function visualizePrompt(wish: string): string {
  return [
    "Покажи на этом фото помещения мебель на заказ, сохранив стены, окна, пол и ракурс.",
    "Фотореалистично, без людей, без текста и логотипов.",
    wish ? `Пожелания заказчика: ${wish}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function createGatewayProvider(opts: GatewayProviderOptions): AiProvider {
  const textUsage = (u: { inputTokens: number | undefined; outputTokens: number | undefined }): AiUsageInfo => ({
    model: opts.textModelId,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
  });

  const abortSignal = () => AbortSignal.timeout(opts.timeoutMs ?? AI_CALL_TIMEOUT_MS);

  return {
    name: "gateway",

    async structureRequest({ text, furnitureTypes }) {
      try {
        const result = await generateText({
          model: opts.textModel,
          system: systemPrompt(furnitureTypes),
          prompt: text,
          output: Output.object({ schema: requestDraftSuggestionSchema }),
          maxRetries: 1,
          abortSignal: abortSignal(),
        });
        return { raw: result.output, usage: textUsage(result.usage) };
      } catch (e) {
        // Модель ответила не по схеме: токены потрачены — отдаём текст на проверку сервису и учёт.
        if (NoObjectGeneratedError.isInstance(e)) return { raw: e.text ?? null, usage: textUsage(e.usage ?? { inputTokens: undefined, outputTokens: undefined }) };
        throw e;
      }
    },

    async visualizeRoom({ image, prompt }) {
      if ((await opts.imageModel.supportsFileInputs) === false) fail.unavailable(ru.ai.errors.imageInputUnsupported);
      const result = await generateImage({
        model: opts.imageModel,
        prompt: { images: [image], text: visualizePrompt(prompt) },
        n: 1,
        maxRetries: 1,
        abortSignal: abortSignal(),
      });
      return {
        images: result.images.map((img) => ({ data: img.uint8Array, contentType: img.mediaType })),
        usage: { model: opts.imageModelId, images: result.images.length },
      };
    },
  };
}
