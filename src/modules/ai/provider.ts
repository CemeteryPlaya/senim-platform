/**
 * ИИ-провайдер. Персональные данные (ИИН, телефоны, адреса, имена) провайдеру не передаются —
 * ai-модуль вычищает их до вызова.
 */

export type AiUsageInfo = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  costUsdMicros: number;
};

/** Черновик заявки из свободного текста. Структура проверяется zod-схемой в ai-модуле. */
export type RequestDraftSuggestion = {
  furnitureTypeSlug: string | null;
  customType: string | null;
  style: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  materials: string[];
  wishes: string;
};

export interface AiProvider {
  readonly name: "mock" | "gateway";
  structureRequest(input: {
    text: string;
    furnitureTypes: { slug: string; name: string }[];
    styles: { key: string; name: string }[];
  }): Promise<{ draft: RequestDraftSuggestion; usage: AiUsageInfo }>;
  visualizeRoom(input: {
    image: Uint8Array;
    contentType: string;
    prompt: string;
  }): Promise<{ images: { data: Uint8Array; contentType: string }[]; usage: AiUsageInfo }>;
}
