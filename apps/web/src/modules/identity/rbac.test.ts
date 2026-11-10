import { describe, expect, it } from "vitest";
import { AppError } from "@/platform/errors";
import { authorize, can } from "./rbac";
import type { CurrentUser } from "./session";

const client = user("c1", "CLIENT");
const otherClient = user("c2", "CLIENT");
const operator = user("op", "OPERATOR");
const executor = user("u-ex", "EXECUTOR", { id: "ex1", publicNumber: 1, status: "APPROVED" });
const otherExecutor = user("u-ex2", "EXECUTOR", { id: "ex2", publicNumber: 2, status: "APPROVED" });
const pendingExecutor = user("u-ex3", "EXECUTOR", { id: "ex3", publicNumber: 3, status: "PENDING" });

const request = { kind: "request", clientId: "c1" } as const;
const deal = { kind: "deal", clientId: "c1", executorId: "ex1" } as const;
const profile = { kind: "executorProfile", id: "ex1" } as const;

describe("can: заявка", () => {
  it("видит владелец и оператор, не видит чужой заказчик", () => {
    expect(can(client, "view", request)).toBe(true);
    expect(can(operator, "view", request)).toBe(true);
    expect(can(otherClient, "view", request)).toBe(false);
  });

  it("менять может только владелец", () => {
    expect(can(client, "manage", request)).toBe(true);
    expect(can(operator, "manage", request)).toBe(false);
    expect(can(otherClient, "manage", request)).toBe(false);
    expect(can(executor, "manage", request)).toBe(false);
  });
});

describe("can: сделка", () => {
  it("видят стороны сделки и оператор", () => {
    expect(can(client, "view", deal)).toBe(true);
    expect(can(executor, "view", deal)).toBe(true);
    expect(can(operator, "view", deal)).toBe(true);
    expect(can(otherClient, "view", deal)).toBe(false);
    expect(can(otherExecutor, "view", deal)).toBe(false);
  });

  it("действуют только стороны; исполнитель — только подтверждённый", () => {
    expect(can(client, "act", deal)).toBe(true);
    expect(can(executor, "act", deal)).toBe(true);
    expect(can(operator, "act", deal)).toBe(false);
    expect(can({ ...pendingExecutor, executor: { ...pendingExecutor.executor!, id: "ex1" } }, "act", deal)).toBe(false);
  });

  it("спор по сделке решает только оператор", () => {
    expect(can(operator, "resolveDispute", deal)).toBe(true);
    expect(can(client, "resolveDispute", deal)).toBe(false);
    expect(can(executor, "resolveDispute", deal)).toBe(false);
  });
});

describe("can: профиль исполнителя", () => {
  it("редактирует только сам исполнитель", () => {
    expect(can(executor, "edit", profile)).toBe(true);
    expect(can(otherExecutor, "edit", profile)).toBe(false);
    expect(can(operator, "edit", profile)).toBe(false);
  });

  it("модерирует только оператор", () => {
    expect(can(operator, "moderate", profile)).toBe(true);
    expect(can(executor, "moderate", profile)).toBe(false);
  });
});

describe("can: платформа", () => {
  it("настройки платформы — только оператор", () => {
    expect(can(operator, "administer", { kind: "platform" })).toBe(true);
    expect(can(client, "administer", { kind: "platform" })).toBe(false);
    expect(can(executor, "administer", { kind: "platform" })).toBe(false);
  });
});

describe("can: две роли у одного человека (ADR-004) — права только активной роли", () => {
  // Один аккаунт: заказчик заявки c1 и исполнитель ex1.
  const both = ["CLIENT", "EXECUTOR"] as const satisfies CurrentUser["roles"];
  const asClient = user("c1", "CLIENT", { id: "ex1", publicNumber: 1, status: "APPROVED" }, [...both]);
  const asExecutor = { ...asClient, role: "EXECUTOR" as const };

  it("в роли заказчика — права заказчика, но не исполнителя", () => {
    expect(can(asClient, "manage", request)).toBe(true);
    expect(can(asClient, "edit", profile)).toBe(false);
  });

  it("в роли исполнителя — права исполнителя, но не заказчика", () => {
    expect(can(asExecutor, "edit", profile)).toBe(true);
    expect(can(asExecutor, "manage", request)).toBe(false);
  });

  it("сделку, где он сторона в другой роли, видит только в той роли", () => {
    const asClientDeal = { kind: "deal", clientId: "c1", executorId: "ex2" } as const;
    expect(can(asClient, "view", asClientDeal)).toBe(true);
    expect(can(asExecutor, "view", asClientDeal)).toBe(false);
  });
});

describe("authorize", () => {
  it("молчит, если можно, и бросает FORBIDDEN, если нельзя", () => {
    expect(() => authorize(client, "view", request)).not.toThrow();
    expect(() => authorize(otherClient, "view", request)).toThrow(AppError);
    try {
      authorize(otherClient, "view", request);
    } catch (e) {
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });
});

function user(id: string, role: CurrentUser["role"], executorProfile: CurrentUser["executor"] = null, roles: CurrentUser["roles"] = [role]): CurrentUser {
  return { id, role, roles, phone: "+77000000000", fullName: null, iinLast4: null, isDemo: false, executor: executorProfile, mfa: { required: role === "OPERATOR", verifiedAt: null } };
}
