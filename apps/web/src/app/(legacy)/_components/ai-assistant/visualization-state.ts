import type { VisualizationView } from "@/modules/ai/client";

export const isPending = (status: VisualizationView["status"]) => status === "QUEUED" || status === "RUNNING";

export const pendingIds = (items: readonly VisualizationView[]) => items.filter((v) => isPending(v.status)).map((v) => v.id);

/** Обновлённая — на своё место, новая — в начало (список от новых к старым). */
export function mergeView(items: readonly VisualizationView[], next: VisualizationView): VisualizationView[] {
  return items.some((v) => v.id === next.id) ? items.map((v) => (v.id === next.id ? next : v)) : [next, ...items];
}
