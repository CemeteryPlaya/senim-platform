/**
 * ИИ-провайдер. Персональные данные (ИИН, телефоны, адреса, имена) провайдеру не передаются —
 * сервис ai-модуля вычищает их (scrubPii) до вызова.
 *
 * Провайдер не считает деньги и не проверяет ответ: стоимость — по таблице pricing.ts,
 * структура ответа — zod-схемой schema.ts в сервисе. Так у каждого решения одно место.
 */

export type AiUsageInfo = {
  /** Идентификатор модели для учёта и таблицы цен: «mock/text», «openai/gpt-…». */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
};

export type StructureRequestInput = {
  /** Текст заказчика, уже без персональных данных. */
  text: string;
  /** Активные типы мебели из справочника оператора. */
  furnitureTypes: readonly { slug: string; name: string }[];
};

export type VisualizeRoomInput = {
  image: Uint8Array;
  contentType: string;
  /** Пожелания к иллюстрации, уже без персональных данных. */
  prompt: string;
};

export type GeneratedImage = { data: Uint8Array; contentType: string };

export interface AiProvider {
  readonly name: "mock" | "gateway";
  /** Черновик заявки из свободного текста. `raw` — непроверенный ответ модели. */
  structureRequest(input: StructureRequestInput): Promise<{ raw: unknown; usage: AiUsageInfo }>;
  /** Иллюстрация мебели в помещении по фото. Пометку «Иллюстрация ИИ» ставит сервис. */
  visualizeRoom(input: VisualizeRoomInput): Promise<{ images: GeneratedImage[]; usage: AiUsageInfo }>;
}
