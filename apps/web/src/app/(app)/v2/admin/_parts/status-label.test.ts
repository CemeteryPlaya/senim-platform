import { describe, expect, it } from "vitest";
import { DealStatus, RegistrationStatus, RequestStatus } from "@/generated/prisma/enums";
import { statusLabel } from "./status-label";

describe("statusLabel: статусы в таблицах статистики по-русски", () => {
  it.each([
    ["requests", Object.values(RequestStatus)],
    ["deals", Object.values(DealStatus)],
    ["masters", Object.values(RegistrationStatus)],
  ] as const)("у каждого статуса таблицы %s есть русское название", (kind, statuses) => {
    for (const status of statuses) expect(statusLabel(kind, status)).toMatch(/[а-яё]/i);
  });

  it("сделка и мастер — формулировками оператора", () => {
    expect(statusLabel("deals", "PAID_HOLD")).toBe("Оплачено, работа не начата");
    expect(statusLabel("masters", "PENDING")).toBe("На проверке");
    expect(statusLabel("requests", "DRAFT")).toBe("Черновик");
  });

  it("неизвестный статус — как есть", () => {
    expect(statusLabel("deals", "SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
