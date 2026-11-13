import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html, text } from "@/kit/test-utils";
import type { MoneyBlock } from "@/modules/payments";
import { dealStepsView } from "../../../_parts/deal-summary";
import { cancelText, moneyView, nowView, type NowInput } from "./deal-card";
import { DealCardView, type CardView } from "./DealCardView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), redirect: () => undefined }));
vi.mock("@/modules/identity", () => ({ requireUser: async () => ({}) }));
vi.mock("@/modules/deal-core", () => ({ cancelDeal: async () => ({ status: "CANCELLED" }), cancelDealSchema: {} }));
vi.mock("@/platform/action", () => ({ action: () => async () => ({ ok: true }) }));

const t = ru.app.deal.card;

const awaiting: MoneyBlock = { kind: "awaiting", payment: "none", bankBalanceTiyn: 0n, isTest: true };
const held: MoneyBlock = { kind: "protected", amountTiyn: 102_000_00n, reservedAt: new Date(), operationRef: null, bankBalanceTiyn: 102_000_00n, isTest: true };

const nowBase: NowInput = {
  id: "d1",
  next: { action: "pay", mine: true },
  contractId: "c1",
  actId: null,
  payTiyn: 102_000_00n,
  bank: null,
  plannedReadyAt: null,
  needsPosition: false,
  refundAll: false,
};

function view(over: Partial<CardView> = {}, block: MoneyBlock = awaiting, now: Partial<NowInput> = {}): CardView {
  const money = moneyView({ block, estimate: { priceTiyn: 100_000_00n, extraTiyn: 2_000_00n, totalTiyn: 102_000_00n }, snapshot: { priceTiyn: 100_000_00n, protectionTiyn: 2_000_00n } });
  return {
    id: "d1",
    title: "Кухня",
    lead: t.lead(7, "Исполнитель №4"),
    chip: { text: ru.app.deal.status.CREATED, tone: "warn" },
    now: nowView({ ...nowBase, ...now }),
    steps: dealStepsView("CREATED", false, "pay"),
    money: { ...money, historyHref: "/v2/deals/d1/money" },
    order: [{ label: t.order.what, value: "Кухня" }],
    documents: [{ id: "c1", name: "Оферта № Д-1", status: "Подписан", href: "/api/documents/c1/pdf" }],
    master: { label: "Исполнитель №4", contacts: null, chatHref: "/v2/chats/o1" },
    history: { items: [{ title: "Оферта сформирована", time: "1 ноября 2026, 10:00" }], more: true, allHref: "/v2/deals/d1?history=all#history" },
    actions: { cancelText: cancelText({ canCancel: true, status: "CREATED", block }), disputeHref: null },
    ...over,
  };
}

const primaries = (out: string) => [...out.matchAll(/<a [^>]*data-primary-action[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));

describe.each(["mobile", "desktop"] as const)("карточка сделки, %s", (device) => {
  it("один h1 — название заказа; «Назад: Сделки»; номер сделки и «Исполнитель №N» вторичной строкой; плашка статуса", () => {
    const out = html(<DealCardView view={view()} device={device} />);
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe("Кухня");
    expect(out).toContain('href="/v2/deals"');
    expect(out).toContain(t.lead(7, "Исполнитель №4"));
    expect(out).toContain(ru.app.deal.status.CREATED);
  });

  it("оплата: одно главное действие «Оплатить N ₸» на экран оплаты", () => {
    const out = html(<DealCardView view={view()} device={device} />);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]?.href).toBe("/v2/deals/d1/pay");
    expect(text(<DealCardView view={view()} device={device} />)).toMatch(/Оплатить 102\s000\s₸/);
  });

  it("ждём мастера — главного действия нет", () => {
    const out = html(<DealCardView view={view({}, held, { next: { action: "waitReady", mine: false } })} device={device} />);
    expect(out).not.toContain("data-primary-action");
    expect(out).toContain(t.now.waitReady.title);
  });

  it("деньги: «Защита сделки (2%)» с пояснением, «История денег»; без слов «комиссия», «эскроу», «тестов», «платформ», «демо», «отклик»", () => {
    const out = text(<DealCardView view={view({}, held)} device={device} />);
    expect(out).toContain("Защита сделки (2%)");
    expect(out).toContain(t.money.explain.label);
    expect(out).toContain(t.money.history);
    expect(out).toContain("Деньги в банке под защитой");
    expect(out).not.toMatch(/комисси|эскроу|тестов|платформ|демо|отклик/i);
  });

  it("мастер до оферты: «Исполнитель №N», контакты скрыты с пояснением; «Написать мастеру» — в диалог", () => {
    const out = html(<DealCardView view={view()} device={device} />);
    expect(out).toContain(t.master.hidden);
    expect(out).toContain(t.master.explain.label);
    expect(out).not.toContain("tel:");
    expect(out).toContain('href="/v2/chats/o1"');
  });

  it("мастер после оферты: телефон ссылкой tel:, Instagram ссылкой", () => {
    const contacts = { of: "executor" as const, phone: "+77000000204", phoneDisplay: "+7 700 000 02 04", instagram: "master.kz" };
    const out = html(<DealCardView view={view({ master: { label: "ТОО Мебель", contacts, chatHref: "/v2/chats/o1" } })} device={device} />);
    expect(out).toContain('href="tel:+77000000204"');
    expect(out).toContain('href="https://www.instagram.com/master.kz/"');
    expect(out).not.toContain(t.master.hidden);
  });

  it("документы — ссылки на PDF модуля; история — «Показать всё»", () => {
    const out = html(<DealCardView view={view()} device={device} />);
    expect(out).toContain('href="/api/documents/c1/pdf"');
    expect(out).toContain('href="/v2/deals/d1?history=all#history"');
  });

  it("меню «Действия» — только когда есть что делать", () => {
    expect(html(<DealCardView view={view()} device={device} />)).toContain(`aria-label="${t.actions.menu}"`);
    const none = view({ actions: { cancelText: null, disputeHref: null } });
    expect(html(<DealCardView view={none} device={device} />)).not.toContain(`aria-label="${t.actions.menu}"`);
  });
});

it("телефон: главное действие — в доке, последним на экране; компьютер — под «Сейчас»", () => {
  const mobile = html(<DealCardView view={view()} device="mobile" />);
  expect(mobile.lastIndexOf("data-primary-action")).toBeGreaterThan(mobile.indexOf(ru.app.kit.help.title));
  const desktop = html(<DealCardView view={view()} device="desktop" />);
  expect(desktop.indexOf("data-primary-action")).toBeLessThan(desktop.indexOf(t.steps.section));
});
