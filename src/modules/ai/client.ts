// Клиентская точка входа модуля ai (без server-only): схемы ввода, пределы и типы для компонентов.
export {
  ASSIST_TEXT_MAX,
  ASSIST_TEXT_MIN,
  assistInputSchema,
  VISUALIZE_PROMPT_MAX,
  visualizeInputSchema,
  type DetailUnknown,
  type DraftDetails,
  type RequestDraft,
} from "./schema";
export type { AssistResult } from "./assist";
export type { VisualizationList, VisualizationView } from "./visualize";
