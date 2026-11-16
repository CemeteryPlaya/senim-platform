import { describe, expect, it } from "vitest";
import { notificationTarget } from "./notification-target";

describe("notificationTarget: куда ведёт уведомление (список и push)", () => {
  it.each([
    ["/operator/kyc", "/v2/operator/kyc"],
    ["/operator/executors/p1", "/v2/operator/executors/p1"],
    ["/operator/deals/d1", "/v2/operator/deals/d1"],
    ["/operator/requests", "/v2/operator/requests"],
    ["/operator/settings?tab=1", "/v2/operator/settings?tab=1"],
  ])("оператор: перенесённый раздел %s — экран v2", (link, target) => {
    expect(notificationTarget("OPERATOR", link)).toBe(target);
  });

  it("оператор: раздела в v2 нет — ссылка v1 как есть, без заглушки", () => {
    expect(notificationTarget("OPERATOR", "/deals/7")).toBe("/deals/7");
    expect(notificationTarget("OPERATOR", "/operator/unknown")).toBe("/operator/unknown");
  });

  it("замерщик — ссылка v1 как есть", () => {
    expect(notificationTarget("MEASURER", "/measurer/visits/1")).toBe("/measurer/visits/1");
  });

  it("покупатель и мастер — экран v2", () => {
    expect(notificationTarget("CLIENT", "/deals/7")).toBe("/v2/deals/7");
    expect(notificationTarget("EXECUTOR", "/executor/offers")).toBe("/v2/executor/offers");
  });

  it("чужой сайт — главная (v2 у покупателя и мастера), а не внешний адрес", () => {
    expect(notificationTarget("CLIENT", "https://evil.example/x")).toBe("/v2");
    expect(notificationTarget("OPERATOR", "//evil.example")).toBe("/");
    expect(notificationTarget("MEASURER", "https://evil.example")).toBe("/");
  });
});
