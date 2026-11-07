import { createGateway } from "ai";
import { ru } from "@/i18n/ru";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { AiProvider } from "../provider";
import { createGatewayProvider } from "./gateway";
import { mockProvider } from "./mock";

/** Провайдер по AI_PROVIDER. Для gateway нужны ключ и обе модели (их выбирает владелец). */
export function aiProviderFromEnv(): AiProvider {
  const e = env();
  if (e.AI_PROVIDER === "mock") return mockProvider;
  // env.ts требует ключ и модели при AI_ENABLED; здесь — на случай AI_PROVIDER=gateway при выключенном ИИ.
  if (!e.AI_GATEWAY_API_KEY || !e.AI_TEXT_MODEL || !e.AI_IMAGE_MODEL) return fail.unavailable(ru.ai.errors.notConfigured);
  const gw = createGateway({ apiKey: e.AI_GATEWAY_API_KEY });
  return createGatewayProvider({
    textModel: gw.languageModel(e.AI_TEXT_MODEL),
    textModelId: e.AI_TEXT_MODEL,
    imageModel: gw.imageModel(e.AI_IMAGE_MODEL),
    imageModelId: e.AI_IMAGE_MODEL,
  });
}
