import { describe, expect, it } from "vitest";
import type { VisualizationView } from "@/modules/ai/client";
import { isPending, mergeView, pendingIds } from "./visualization-state";

const view = (id: string, status: VisualizationView["status"]): VisualizationView => ({
  id,
  status,
  error: null,
  prompt: "",
  sourceFileId: "f",
  createdAt: "2026-10-30T10:00:00.000Z",
  results: [],
});

describe("состояние списка иллюстраций", () => {
  it("опрашиваются только иллюстрации в очереди и в работе", () => {
    const items = [view("a", "QUEUED"), view("b", "RUNNING"), view("c", "DONE"), view("d", "FAILED")];
    expect(pendingIds(items)).toEqual(["a", "b"]);
    expect(isPending("DONE")).toBe(false);
  });

  it("обновлённая иллюстрация заменяет старую на том же месте", () => {
    const items = [view("a", "QUEUED"), view("b", "RUNNING")];
    const merged = mergeView(items, { ...view("b", "DONE"), results: [{ id: "r", url: "/x" }] });
    expect(merged.map((v) => v.status)).toEqual(["QUEUED", "DONE"]);
    expect(merged[1].results).toHaveLength(1);
  });

  it("новая иллюстрация добавляется в начало", () => {
    expect(mergeView([view("a", "DONE")], view("n", "QUEUED")).map((v) => v.id)).toEqual(["n", "a"]);
  });
});
