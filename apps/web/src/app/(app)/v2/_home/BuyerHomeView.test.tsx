import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, hasClass, html } from "@/kit/test-utils";
import type { DealListItem } from "@/modules/deal-core";
import type { Device } from "@/platform/device";
import { BuyerHomeView } from "./BuyerHomeView";
import { buyerHome, type HomeDealInput, type HomeInput, type HomeRequestInput } from "./buyer-home";

const t = ru.app.buyer.home;

const request = (over: Partial<HomeRequestInput> = {}): HomeRequestInput => ({ id: "r1", number: 1, title: "Кухня", status: "OPEN", offersCount: 0, ...over });
const dealInput = (over: Partial<HomeDealInput> = {}): HomeDealInput => ({ id: "d1", title: "Кухня угловая", status: "IN_PROGRESS", hasOpenDispute: false, paid: true, next: { action: "waitReady", mine: false }, ...over });

const listItem = (over: Partial<DealListItem> = {}): DealListItem => ({
  id: "d1",
  number: 1,
  title: "Кухня угловая",
  status: "IN_PROGRESS",
  isDemo: true,
  priceTiyn: 120_000_000n,
  estimate: { party: "CLIENT", priceTiyn: 120_000_000n, extraTiyn: 2_400_000n, totalTiyn: 122_400_000n },
  money: { kind: "protected", amountTiyn: 122_400_000n, reservedAt: new Date("2026-11-01T10:00:00Z"), operationRef: null, bankBalanceTiyn: 122_400_000n, isTest: true },
  hasOpenDispute: false,
  executorLabel: "Исполнитель №3",
  updatedAt: new Date("2026-11-02T10:00:00Z"),
  myRole: "CLIENT",
  ...over,
});

function render(input: HomeInput, device: Device, deal: DealListItem | null = null, name: string | null = "Иван") {
  return html(<BuyerHomeView view={buyerHome(input)} name={name} deal={deal} device={device} />);
}

const primaryOf = (out: string) => out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);

const SCREENS: { name: string; input: HomeInput; deal?: DealListItem; label: string | null; href?: string }[] = [
  { name: "новый человек", input: { deals: [], requests: [] }, label: "Заказать мебель", href: "/v2/requests/new" },
  { name: "черновик", input: { deals: [], requests: [request({ id: "dr", status: "DRAFT" })] }, label: "Продолжить заявку", href: "/v2/requests/new?draft=dr" },
  { name: "заявка ждёт предложений", input: { deals: [], requests: [request()] }, label: null },
  { name: "заявка с предложениями", input: { deals: [], requests: [request({ offersCount: 2 })] }, label: "Посмотреть предложения", href: "/v2/requests/r1" },
  { name: "сделка ждёт оплаты", input: { deals: [dealInput({ status: "CREATED", paid: false, next: { action: "pay", mine: true } })], requests: [] }, deal: listItem({ status: "CREATED", money: { kind: "awaiting", payment: "none", bankBalanceTiyn: 0n, isTest: false } }), label: "Оплатить заказ", href: "/v2/deals/d1" },
  { name: "сделка идёт, ждём мастера", input: { deals: [dealInput()], requests: [] }, deal: listItem(), label: null },
  { name: "открытый спор", input: { deals: [dealInput({ hasOpenDispute: true, next: { action: "waitDispute", mine: false } })], requests: [] }, deal: listItem({ hasOpenDispute: true }), label: null },
  { name: "мебель сдана, ждёт приёмки", input: { deals: [dealInput({ status: "READY", next: { action: "signAct", mine: true } })], requests: [] }, deal: listItem({ status: "READY" }), label: "Принять мебель", href: "/v2/deals/d1" },
];

describe.each(["mobile", "desktop"] as const)("главная покупателя (%s)", (device) => {
  it.each(SCREENS)("$name: один h1, не больше одного главного действия, подпись и адрес", ({ input, deal, label, href }) => {
    const out = render(input, device, deal ?? null);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(label ? 1 : 0);
    if (label) {
      const primary = primaryOf(out);
      expect(primary?.[1]).toBe(label);
      if (href) expect(primary?.[0]).toContain(`href="${href}"`);
    }
  });

  it("заголовок — приветствие по имени; без имени — просто «Здравствуйте»", () => {
    expect(render({ deals: [], requests: [] }, device).match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe("Здравствуйте, Иван");
    expect(render({ deals: [], requests: [] }, device, null, null).match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe("Здравствуйте");
  });

  it("пустое состояние: «Сейчас» — «Закажите мебель», отдельной карточки пустого списка и второй кнопки нет", () => {
    const out = render({ deals: [], requests: [] }, device);
    expect(out).toContain(`>${t.now.order.title}</h2>`);
    expect(out).not.toContain(t.requests.section);
    expect(out).not.toContain(t.deal.section);
    expect(count(out, "data-primary-action")).toBe(1);
  });

  it("первые шаги: профиль пройден, у нового человека три остальных; шаг «Заказать мебель» — ссылка, не главное действие", () => {
    const out = render({ deals: [], requests: [] }, device);
    expect(out).toContain(ru.app.kit.firstSteps.left(3));
    for (const label of [t.steps.profile, t.steps.order, t.steps.master, t.steps.pay]) expect(out).toContain(label);
    // Шаг — ссылка (внутри списка шагов), а не вторая главная кнопка.
    expect(out).toMatch(/<li><a class="[^"]*" href="\/v2\/requests\/new"><span aria-hidden/);
  });

  it("после оплаты первых шагов нет", () => {
    const out = render({ deals: [dealInput()], requests: [] }, device, listItem());
    expect(out).not.toContain(ru.app.kit.firstSteps.progressLabel);
  });

  it("справа или в конце — «Помощь»", () => {
    const out = render({ deals: [], requests: [] }, device);
    expect(out).toContain(ru.app.kit.help.title);
  });

  it("карточка сделки: название ссылкой, ход, сумма под защитой из данных; пометок «тестовый» нет", () => {
    const out = render({ deals: [dealInput()], requests: [] }, device, listItem());
    expect(out).toContain(">Кухня угловая</a>");
    expect(out).toContain('href="/v2/deals/d1"');
    expect(out).toContain(ru.deal.status.IN_PROGRESS);
    expect(out).toContain(t.deal.steps[1]);
    expect(out.replace(/\s+/g, " ")).toContain("1 224 000 ₸");
    expect(out).toContain(ru.common.home.client.inBank);
    expect(out).not.toMatch(/тестов|демо|комисси|эскроу|платформ/i);
  });

  it("спор: вместо шкалы строка, плашка «Открыт спор», главной кнопки нет", () => {
    const out = render({ deals: [dealInput({ hasOpenDispute: true, next: { action: "waitDispute", mine: false } })], requests: [] }, device, listItem({ hasOpenDispute: true }));
    expect(out).toContain(t.deal.stopped.dispute);
    expect(out).toContain(ru.deal.disputeOpenBadge);
    expect(count(out, "data-primary-action")).toBe(0);
  });

  it("несколько сделок: «Все сделки»; одна — без ссылки", () => {
    const many = render({ deals: [dealInput(), dealInput({ id: "d2" })], requests: [] }, device, listItem());
    expect(many).toContain(t.deal.allDeals);
    expect(render({ deals: [dealInput()], requests: [] }, device, listItem())).not.toContain(t.deal.allDeals);
  });

  it("заявки: название, статус и число предложений; «Все заявки»; заявка из «Сейчас» не повторяется", () => {
    const out = render(
      { deals: [dealInput()], requests: [request({ id: "a", number: 4, title: "Шкаф", offersCount: 3 }), request({ id: "dr", number: 5, title: "Прихожая", status: "DRAFT" })] },
      device,
      listItem(),
    );
    expect(out).toContain(ru.requests.requestTitle(4, "Шкаф"));
    expect(out).toContain(t.requests.offers(3));
    expect(out).toContain(`${ru.requests.status.DRAFT}<`);
    expect(out).toContain('href="/v2/requests/new?draft=dr"');
    expect(out).toContain(t.requests.all);
    // Предложения по заявке «a» — в карточке списка, а не в «Сейчас» (сделка важнее).
    expect(out).toContain(`>${t.now.waiting.waitReady}</h2>`);
  });

  it("ожидание заявки: «Сейчас» с ссылкой на заявку, списка нет, главной кнопки нет", () => {
    const out = render({ deals: [], requests: [request({ number: 9, title: "Кухня" })] }, device);
    expect(out).toContain(`>${t.now.requestWaiting.title}</h2>`);
    expect(out).toContain(ru.requests.requestTitle(9, "Кухня"));
    expect(out).toContain(t.now.requestWaiting.link);
    expect(out).not.toContain(t.requests.section);
    expect(count(out, "data-primary-action")).toBe(0);
  });
});

describe("главная покупателя: устройства", () => {
  it("телефон: действие в доке — последний ребёнок корневой колонки, после «Помощи»", () => {
    const out = render({ deals: [], requests: [] }, "mobile");
    expect(count(out, "data-action-dock")).toBe(1);
    expect(out.indexOf("data-action-dock")).toBeGreaterThan(out.indexOf(ru.app.kit.help.title));
    expect(out.trimEnd().endsWith("</div></div>")).toBe(true);
  });

  it("компьютер: действие под «Сейчас», в основной колонке (до «Помощи»)", () => {
    const out = render({ deals: [], requests: [] }, "desktop");
    expect(count(out, "data-action-dock")).toBe(1);
    expect(out.indexOf("data-action-dock")).toBeGreaterThan(out.indexOf(`>${t.now.order.title}</h2>`));
    expect(out.indexOf("data-action-dock")).toBeLessThan(out.indexOf(ru.app.kit.help.title));
  });

  it("Split: слева процесс, справа «Помощь»", () => {
    const out = render({ deals: [dealInput()], requests: [] }, "desktop", listItem());
    const grid = out.match(/<div [^>]*desktop:grid-cols-split[^>]*>/)?.[0] ?? "";
    expect(hasClass(grid, "desktop:grid")).toBe(true);
    const aside = out.slice(out.lastIndexOf('<div class="min-w-0">'));
    expect(aside).toContain(ru.app.kit.help.title);
    expect(aside).not.toContain(t.deal.section);
  });

  it("разделы через 24/32 px, карточки группы — через 12 px", () => {
    const out = render({ deals: [], requests: [] }, "desktop");
    expect(out).toMatch(/^<div class="[^"]*gap-stack-section/);
    expect(out).toContain("gap-stack-group");
  });
});
