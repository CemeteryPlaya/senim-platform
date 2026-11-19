import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import { HowToTakeOrder } from "./HowToTakeOrder";

const t = ru.app.masterRequests.howTo;

describe("блок «Как взять заказ»", () => {
  it("заголовок h2 и нумерованный список из четырёх шагов; главного действия нет", () => {
    const out = html(<HowToTakeOrder beforeApproval={false} />);
    expect(out).toMatch(new RegExp(`<h2[^>]*>${t.title}</h2>`));
    expect(count(out, "<ol")).toBe(1);
    expect(count(out, "<li")).toBe(4);
    expect(t.steps).toHaveLength(4);
    for (const step of t.steps) expect(out).toContain(step);
    expect(out).not.toContain("data-primary-action");
    expect(out).not.toContain(t.beforeApproval);
  });

  it("до одобрения — строка «Заявки откроются после проверки анкеты.» над шагами", () => {
    const out = html(<HowToTakeOrder beforeApproval />);
    expect(out).toContain(t.beforeApproval);
    expect(out.indexOf(t.beforeApproval)).toBeLessThan(out.indexOf("<ol"));
  });
});
