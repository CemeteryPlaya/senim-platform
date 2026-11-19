import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { becomingMaster, loginChoice } from "./role-choice";
import { ROLE_TTL_MS } from "./role-cookie";

type Executor = { id: string; publicNumber: number; status: "PENDING" | "APPROVED" | "REJECTED" } | null;

const user = (role: Role, roles: Role[] = [role], executor: Executor = null) => ({ role, roles, executor });
const pending: Executor = { id: "ex1", publicNumber: 1, status: "PENDING" };
const approved: Executor = { id: "ex1", publicNumber: 1, status: "APPROVED" };

describe("becomingMaster: идёт к профилю мастера", () => {
  it("заказчик без профиля, выбравший «Я мастер», — да", () => {
    expect(becomingMaster(user("CLIENT"), "EXECUTOR")).toBe(true);
  });

  it("выбор «Заказать мебель» или выбора нет — нет", () => {
    expect(becomingMaster(user("CLIENT"), "CLIENT")).toBe(false);
    expect(becomingMaster(user("CLIENT"), null)).toBe(false);
  });

  it("активная роль мастера — нет: дом мастера и так ведёт на анкету или статус", () => {
    expect(becomingMaster(user("EXECUTOR", ["CLIENT", "EXECUTOR"]), "EXECUTOR")).toBe(false);
  });

  it("профиль мастера уже есть — нет", () => {
    expect(becomingMaster(user("CLIENT", ["CLIENT"], pending), "EXECUTOR")).toBe(false);
  });
});

describe("loginChoice: выбор первого шага при входе известного номера", () => {
  it("заказчик без профиля выбрал «Я мастер» — выбор живёт дальше, роль не меняется", () => {
    expect(loginChoice(user("CLIENT"), "EXECUTOR")).toEqual({ keep: true, switchTo: null });
  });

  it("обе роли, активна заказчика, выбрал «Я мастер» — переключение на мастера, выбор забыт", () => {
    expect(loginChoice(user("CLIENT", ["CLIENT", "EXECUTOR"], approved), "EXECUTOR")).toEqual({ keep: false, switchTo: "EXECUTOR" });
  });

  it("обе роли, активна мастера, выбрал «Заказать мебель» — переключение на заказчика, выбор забыт", () => {
    expect(loginChoice(user("EXECUTOR", ["CLIENT", "EXECUTOR"], approved), "CLIENT")).toEqual({ keep: false, switchTo: "CLIENT" });
  });

  it("выбрал уже активную роль — без переключения, выбор забыт", () => {
    expect(loginChoice(user("EXECUTOR", ["EXECUTOR"], pending), "EXECUTOR")).toEqual({ keep: false, switchTo: null });
    expect(loginChoice(user("CLIENT"), "CLIENT")).toEqual({ keep: false, switchTo: null });
  });

  it("мастер без роли заказчика выбрал «Заказать мебель» — роли не выдаются входом, выбор забыт", () => {
    expect(loginChoice(user("EXECUTOR", ["EXECUTOR"], pending), "CLIENT")).toEqual({ keep: false, switchTo: null });
  });

  it.each(["OPERATOR", "MEASURER"] as const)("%s: выбор игнорируется и забывается", (role) => {
    expect(loginChoice(user(role), "EXECUTOR")).toEqual({ keep: false, switchTo: null });
    expect(loginChoice(user(role), "CLIENT")).toEqual({ keep: false, switchTo: null });
  });

  it("выбора нет — нечего хранить и не на что переключать", () => {
    expect(loginChoice(user("CLIENT", ["CLIENT", "EXECUTOR"], approved), null)).toEqual({ keep: false, switchTo: null });
    expect(loginChoice(user("CLIENT"), null)).toEqual({ keep: false, switchTo: null });
  });
});

describe("срок выбора", () => {
  it("сутки: анкету мастера не всегда заполняют за полчаса", () => {
    expect(ROLE_TTL_MS).toBe(86_400_000);
  });
});
