import { describe, expect, it } from "vitest";
import { KycStatus } from "@/gen/senim/identity/v1/identity_pb";
import { kycView } from "./kyc-policy";

/** Экран мастера «Проверка документов» — по статусу identity; переходы решает identity (kyc_policy.go). */
describe("что видит мастер", () => {
  it.each([
    [KycStatus.NOT_SUBMITTED, { state: "NOT_SUBMITTED", canSubmit: true }],
    [KycStatus.PENDING, { state: "PENDING", canSubmit: true }],
    [KycStatus.REJECTED, { state: "REJECTED", canSubmit: true }],
    [KycStatus.VERIFIED, { state: "VERIFIED", canSubmit: false }],
  ] as const)("статус identity %s → %o", (status, view) => {
    expect(kycView(status)).toEqual(view);
  });

  it("неизвестный статус — ошибка контракта, а не «не подано»", () => {
    expect(() => kycView(KycStatus.UNSPECIFIED)).toThrow();
    expect(() => kycView(99 as KycStatus)).toThrow();
  });
});
