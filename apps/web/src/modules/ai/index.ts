import "server-only";

// Публичный API модуля ai. Всё под флагом AI_ENABLED: при false сервисы отвечают fail.unavailable,
// экраны прячут кнопки по aiEnabled().
export type * from "./provider";
export { aiEnabled } from "./deps";
export { assistRequest, type AssistResult } from "./assist";
export {
  getVisualization,
  jobHandlers,
  listVisualizations,
  requestVisualization,
  VISUALIZE_JOB,
  type VisualizationList,
  type VisualizationView,
} from "./visualize";
export { scrubPii } from "./pii";
export {
  assistInputSchema,
  visualizeInputSchema,
  type DraftDetails,
  type RequestDraft,
  type RequestDraftSuggestion,
} from "./schema";
