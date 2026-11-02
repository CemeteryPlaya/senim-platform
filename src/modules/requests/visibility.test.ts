import { describe, expect, it } from "vitest";
import { executorSeesRequest, type RequestVisibilityFacts } from "./visibility";

const approved = { id: "ex1", status: "APPROVED" as const, segment: "COMFORT" as const };
const tender: RequestVisibilityFacts = { mode: "TENDER", status: "OPEN", segment: "COMFORT", targetExecutorId: null, viewerHasOffer: false };

describe("видимость заявки исполнителю (то же правило, что visibleToExecutor)", () => {
  it("открытый тендер своего сегмента — да; чужого сегмента, без сегмента или не открытый — нет", () => {
    expect(executorSeesRequest(approved, tender)).toBe(true);
    expect(executorSeesRequest(approved, { ...tender, segment: "PREMIUM" })).toBe(false);
    expect(executorSeesRequest(approved, { ...tender, segment: null })).toBe(false);
    expect(executorSeesRequest({ ...approved, segment: null }, tender)).toBe(false);
    expect(executorSeesRequest(approved, { ...tender, status: "CONTRACTING" })).toBe(false);
  });

  it("прямой запрос — только целевому исполнителю, сегмент не важен", () => {
    const direct = { ...tender, mode: "DIRECT" as const, segment: "PREMIUM" as const, targetExecutorId: "ex1" };
    expect(executorSeesRequest(approved, direct)).toBe(true);
    expect(executorSeesRequest({ ...approved, id: "ex2" }, direct)).toBe(false);
  });

  it("неподтверждённый не видит; свой отклик видно всегда — и после закрытия заявки", () => {
    expect(executorSeesRequest({ ...approved, status: "PENDING" }, tender)).toBe(false);
    expect(executorSeesRequest({ ...approved, status: "PENDING" }, { ...tender, status: "CLOSED", viewerHasOffer: true })).toBe(true);
  });
});
