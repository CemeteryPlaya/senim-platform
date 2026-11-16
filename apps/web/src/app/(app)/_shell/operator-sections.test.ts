import { describe, expect, it } from "vitest";
import { isOperatorReady, OPERATOR_READY } from "./operator-sections";

describe("isOperatorReady: экраны v2, готовые для оператора", () => {
  it.each([
    ["/v2/operator", true],
    ["/v2/operator/", true],
    ["/v2/operator/mfa", true],
    ["/v2/profile", true],
    ["/v2/notifications", true],
    ["/v2/notifications/n1", true],
    // Очереди (Q2).
    ["/v2/operator/money", true],
    ["/v2/operator/kyc", true],
    ["/v2/operator/consents", true],
    ["/v2/operator/executors", true],
    ["/v2/operator/executors/new", true],
    ["/v2/operator/executors/p1", true],
    // Споры и заявки (Q3).
    ["/v2/operator/disputes", true],
    ["/v2/operator/disputes/d1", true],
    ["/v2/operator/requests", true],
    // Сделки, доход, отчёт, журнал аудита (Q4).
    ["/v2/operator/deals", true],
    ["/v2/operator/deals/7", true],
    ["/v2/operator/income", true],
    ["/v2/operator/income/csv", true],
    ["/v2/operator/report", true],
    ["/v2/operator/report/csv", true],
    ["/v2/operator/audit", true],
  ])("%s — страница v2", (path, ready) => {
    expect(isOperatorReady(path)).toBe(ready);
  });

  it.each([
    // Разделы под главной оператора, ещё не перенесённые: главная — только сама.
    "/v2/operator/dealsx",
    "/v2/operator/moneyx",
    "/v2/operator/mfax",
    "/v2/profile/data",
    "/v2/deals/7",
    "/v2",
    "/v2/operatorx",
  ])("%s — заглушка со ссылкой на v1", (path) => {
    expect(isOperatorReady(path)).toBe(false);
  });

  it("все адреса списка — под префиксом v2, без повторов и без конечного «/»", () => {
    const paths = OPERATOR_READY.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^\/v2\/[a-z/-]+[a-z]$/);
  });
});
