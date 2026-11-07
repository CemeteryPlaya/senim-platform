"use server";

import { assistInputSchema, assistRequest, requestVisualization, visualizeInputSchema } from "@/modules/ai";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Вход проверяет zod-схема модуля ai, права — сервис (только заказчик своей заявки).

export const assistAction = action("ai.assist", assistInputSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return assistRequest(user, input.requestId, input.text);
});

export const requestVisualizationAction = action("ai.visualize", visualizeInputSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return requestVisualization(user, input.requestId, input.sourceFileId, input.prompt);
});
