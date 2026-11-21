import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html, text } from "@/kit/test-utils";
import type { MoneyBlock } from "@/modules/payments";
import { dealStepsView } from "../../../_parts/deal-summary";
import { designView } from "../../../_parts/design-files";
import { cancelText, deliveryView, masterMoneyView, moneyView, nowView, reportsView, reviewRows, type NowInput } from "./deal-card";
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
  side: "CLIENT",
  next: { action: "pay", mine: true },
  contractId: "c1",
  actId: null,
  contractPdf: "/api/documents/c1/pdf",
  payTiyn: 102_000_00n,
  manual: false,
  bank: null,
  plannedReadyAt: null,
  needsPosition: false,
  refundAll: false,
  disputeOutcome: null,
};

function view(over: Partial<CardView> = {}, block: MoneyBlock = awaiting, now: Partial<NowInput> = {}): CardView {
  const money = moneyView({ block, estimate: { priceTiyn: 100_000_00n, extraTiyn: 2_000_00n, totalTiyn: 102_000_00n }, snapshot: { priceTiyn: 100_000_00n, protectionTiyn: 2_000_00n, buyerTotalTiyn: 102_000_00n } });
  return {
    id: "d1",
    side: "CLIENT",
    title: "Кухня",
    lead: t.lead(7, "Исполнитель №4"),
    chip: { text: ru.app.deal.status.pay, tone: "warn" },
    now: nowView({ ...nowBase, ...now }),
    steps: dealStepsView("CREATED", false, null, "CLIENT"),
    cover: null,
    money: { ...money, historyHref: "/v2/deals/d1/money" },
    order: [{ label: t.order.what, value: "Кухня" }],
    documents: [{ id: "c1", name: "Оферта № Д-1", status: "Подписан", href: "/api/documents/c1/pdf", open: ru.app.deal.openDocument.CONTRACT }],
    party: { label: "Исполнитель №4", contacts: null, chatHref: "/v2/chats/o1" },
    reports: null,
    history: { items: [{ title: "Оферта сформирована", time: "1 ноября 2026, 10:00" }], more: true, allHref: "/v2/deals/d1?history=all#history" },
    review: null,
    actions: { cancelText: cancelText({ side: "CLIENT", canCancel: true, status: "CREATED", block, manual: false }), disputeHref: null },
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
    expect(out).toContain(ru.app.deal.status.pay);
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
    const out = html(<DealCardView view={view({ party: { label: "ТОО Мебель", contacts, chatHref: "/v2/chats/o1" } })} device={device} />);
    expect(out).toContain('href="tel:+77000000204"');
    expect(out).toContain('href="https://www.instagram.com/master.kz/"');
    expect(out).not.toContain(t.master.hidden);
  });

  it("документы — ссылки на PDF модуля; история — «Показать всё»", () => {
    const out = html(<DealCardView view={view()} device={device} />);
    expect(out).toContain('href="/api/documents/c1/pdf"');
    expect(out).toContain('href="/v2/deals/d1?history=all#history"');
  });

  it("«Ваш отзыв» — только когда отзыв оставлен: оценка, текст, дата", () => {
    expect(html(<DealCardView view={view()} device={device} />)).not.toContain(t.review.section);
    const rows = reviewRows({ rating: 5, text: "Всё отлично", createdAt: new Date("2026-11-14T10:00:00Z") });
    const out = text(<DealCardView view={view({ review: rows })} device={device} />);
    expect(out).toContain(t.review.section);
    expect(out).toContain(t.review.ratingValue(5));
    expect(out).toContain("Всё отлично");
    expect(out).toContain("14 ноября 2026");
  });

  it("меню «Действия» — только когда есть что делать", () => {
    expect(html(<DealCardView view={view()} device={device} />)).toContain(`aria-label="${t.actions.menu}"`);
    const none = view({ actions: { cancelText: null, disputeHref: null } });
    expect(html(<DealCardView view={none} device={device} />)).not.toContain(`aria-label="${t.actions.menu}"`);
  });
});

it("телефон: деньги сразу после «Сейчас», ход — компактно («Шаг N из 5», полная шкала по нажатию); компьютер — полная шкала", () => {
  const mobile = html(<DealCardView view={view({}, held, { next: { action: "waitReady", mine: false } })} device="mobile" />);
  expect(mobile.indexOf(t.money.section)).toBeLessThan(mobile.indexOf(t.steps.section));
  expect(mobile.indexOf(t.now.waitReady.title)).toBeLessThan(mobile.indexOf(t.money.section));
  expect(mobile).toContain(t.steps.all);
  expect(mobile).toContain("<details");
  const desktop = html(<DealCardView view={view({}, held)} device="desktop" />);
  expect(desktop).not.toContain(t.steps.all);
});

it("фото-герой: обложка сразу под заголовком с шагом на стекле, сумма сразу под обложкой, «Ход работ» выше хода и «Заказа»", () => {
  const items = reportsView([{ id: "r1", title: "Корпус готов", text: "", createdAt: new Date("2026-11-12T10:00:00Z"), photos: [{ id: "p1", src: "/f/p1.jpg" }] }]);
  const over = { steps: dealStepsView("IN_PROGRESS", false, null, "CLIENT"), cover: { src: "/f/p1.jpg", alt: "Корпус готов" }, reports: { items, addHref: null } };
  const mobile = html(<DealCardView view={view(over, held, { next: { action: "waitReady", mine: false } })} device="mobile" />);
  const cover = mobile.indexOf("photo-capsule");
  expect(cover).toBeGreaterThan(mobile.indexOf("<h1"));
  // Шаг сделки — на фото капсулой; сумма сразу под обложкой (раньше «Сейчас»), заголовок «Деньги» — только для диктора.
  expect(mobile.slice(cover, cover + 300)).toContain("Шаг 2 из 5");
  const sum = mobile.indexOf("Деньги в банке под защитой");
  expect(sum).toBeGreaterThan(cover);
  expect(sum).toBeLessThan(mobile.indexOf(t.now.waitReady.title));
  expect(mobile).toMatch(new RegExp(`<h2 id="deal-money" class="sr-only">${t.money.section}</h2>`));
  expect(mobile.indexOf(`>${t.reports.section}<`)).toBeLessThan(mobile.indexOf(`>${t.steps.section}<`));
  expect(mobile.indexOf(`>${t.reports.section}<`)).toBeLessThan(mobile.indexOf(`>${t.order.section}<`));
  // Компьютер: обложка — первой в основной колонке, над «Сейчас».
  const desktop = html(<DealCardView view={view(over, held, { next: { action: "waitReady", mine: false } })} device="desktop" />);
  expect(desktop.indexOf("photo-capsule")).toBeLessThan(desktop.indexOf(t.now.waitReady.title));
  // Без фото — прежний порядок, без обложки.
  expect(html(<DealCardView view={view({}, held)} device="mobile" />)).not.toContain("photo-capsule");
});

it("«…» — в строке заголовка рядом с h1 и без стекла", () => {
  for (const device of ["mobile", "desktop"] as const) {
    const out = html(<DealCardView view={view()} device={device} />);
    const row = out.slice(out.indexOf("<h1"), out.indexOf(`aria-label="${t.actions.menu}"`));
    expect(row).not.toContain("</header>");
    expect(out).not.toContain("glass-regular");
  }
});

it.each(["CLIENT", "EXECUTOR"] as const)("дизайн-проект у стороны %s: фото галереей, PDF ссылкой в новой вкладке, в «Заказе»; нет файлов — нет раздела", (side) => {
  const d = t.design;
  const design = designView(
    [
      { id: "a", kind: "image", src: "/f/a", n: 1 },
      { id: "b", kind: "pdf", src: "/f/b.pdf", n: 2 },
    ],
    d,
  );
  for (const device of ["mobile", "desktop"] as const) {
    const out = html(<DealCardView view={view({ side, design })} device={device} />);
    expect(out).toContain(d.title);
    expect(out).toContain('src="/f/a"');
    expect(out).toContain(`alt="${d.photo(1)}"`);
    expect(out).toMatch(/href="\/f\/b\.pdf"[^>]*target="_blank"/);
    expect(out).toContain("Дизайн-проект, файл 2 (PDF)");
    expect(out.indexOf(t.order.section)).toBeLessThan(out.indexOf(d.title));
  }
  expect(html(<DealCardView view={view({ side })} device="mobile" />)).not.toContain(d.title);
});

it("«Помощь» ведёт в разделы помощи: где деньги и если мебель не понравилась", () => {
  const out = html(<DealCardView view={view()} device="mobile" />);
  expect(out).toContain('href="/v2/help#money"');
  expect(out).toContain('href="/v2/help#not-fit"');
});

it("ссылка на PDF оферты при переводе — обычная ссылка в новом окне", () => {
  const out = html(<DealCardView view={view({}, awaiting, { next: { action: "waitPaymentConfirmation", mine: false }, manual: true })} device="desktop" />);
  expect(out).toMatch(/<a href="\/api\/documents\/c1\/pdf" target="_blank"[^>]*>Открыть оферту/);
});

it("телефон: главное действие — в доке, последним на экране; компьютер — под «Сейчас»", () => {
  const mobile = html(<DealCardView view={view()} device="mobile" />);
  expect(mobile.lastIndexOf("data-primary-action")).toBeGreaterThan(mobile.indexOf(ru.app.kit.help.title));
  const desktop = html(<DealCardView view={view()} device="desktop" />);
  expect(desktop.indexOf("data-primary-action")).toBeLessThan(desktop.indexOf(t.steps.section));
});

describe.each(["mobile", "desktop"] as const)("карточка сделки мастера, %s", (device) => {
  const tm = ru.app.masterDeal.card;
  const estimate = { priceTiyn: 100_000_00n, extraTiyn: 4_000_00n, totalTiyn: 96_000_00n };

  /** Карточка глазами мастера: таблица «что сейчас», деньги, покупатель, ход работ мастера. */
  function masterView(block: MoneyBlock, now: Partial<NowInput>, over: Partial<CardView> = {}): CardView {
    return view({
      side: "EXECUTOR",
      lead: tm.lead(7),
      chip: { text: ru.app.master.deal.status.inWork, tone: "accent" },
      now: nowView({ ...nowBase, side: "EXECUTOR", payTiyn: 0n, ...now }),
      steps: dealStepsView("IN_PROGRESS", false, null, "EXECUTOR"),
      money: { ...masterMoneyView({ block, estimate }), historyHref: "/v2/deals/d1/money" },
      party: { label: null, contacts: null, chatHref: "/v2/chats/o1" },
      reports: { items: [], addHref: null },
      actions: { cancelText: null, disputeHref: "/v2/deals/d1/dispute" },
      ...over,
    });
  }

  it("работа идёт: одно главное действие «Сдать работу», ссылка на отчёт; деньги мастера без сумм покупателя", () => {
    const view = masterView(held, { next: { action: "submitReady", mine: true } });
    const out = html(<DealCardView view={view} device={device} />);
    expect(primaries(out)).toEqual([{ href: "/v2/deals/d1/ready", label: ru.app.master.deal.now.ready.action }]);
    expect(out).toContain('href="/v2/deals/d1/progress"');
    const shown = text(<DealCardView view={view} device={device} />);
    expect(shown).toContain(tm.money.youGetAfter);
    expect(shown).toContain(tm.money.protected);
    expect(shown).toContain(tm.money.guarantee);
    expect(shown).toContain(tm.money.youGet);
    expect(shown).toContain(tm.money.explain.label);
    // Ни защиты сделки покупателя, ни суммы оплаты покупателя (102 000 ₸), ни «к оплате».
    expect(shown).not.toMatch(/2\s?%|Защита сделки|102\s000|к оплате/i);
    expect(shown).not.toMatch(/комисси|эскроу|тестов|платформ|демо|отклик|заказчик|выплат/i);
  });

  it("другая сторона — «Покупатель»: контакты до оферты скрыты, «Написать покупателю»; лид — номер сделки", () => {
    const out = html(<DealCardView view={masterView(awaiting, { next: { action: "signContract", mine: true } })} device={device} />);
    expect(out).toContain(tm.buyer.section);
    expect(out).toContain(tm.buyer.hidden);
    expect(out).toContain(tm.buyer.write);
    expect(out).not.toContain(t.master.write);
    expect(out).toContain(tm.lead(7));
    expect(out).toContain('href="/v2/help#dispute"');
    expect(out).not.toContain('href="/v2/help#not-fit"');
  });

  it("ход работ: отчёты свежими сверху с фото, ссылка «Добавить отчёт» — когда передана", () => {
    const items = reportsView([
      { id: "r1", title: "", text: "Начали сборку", createdAt: new Date("2026-11-10T10:00:00Z"), photos: [] },
      { id: "r2", title: "Корпус готов", text: "", createdAt: new Date("2026-11-12T10:00:00Z"), photos: [{ id: "p1", src: "/f/p1.jpg" }] },
    ]);
    const out = html(<DealCardView view={masterView(held, { next: { action: "signActEcp", mine: true }, actId: "a1" }, { reports: { items, addHref: "/v2/deals/d1/progress" } })} device={device} />);
    expect(out).toContain(t.reports.section);
    expect(out.indexOf("Корпус готов")).toBeLessThan(out.indexOf(t.reports.untitled));
    expect(out).toContain('src="/f/p1.jpg"');
    expect(out).toContain(tm.reports.add);
    expect(primaries(out)).toEqual([{ href: "/v2/deals/d1/sign/a1", label: ru.app.master.deal.now.signAct.action }]);
  });

  it("у покупателя без отчётов блока «Ход работ» нет", () => {
    expect(html(<DealCardView view={view()} device={device} />)).not.toContain(t.reports.section);
  });

  it("покупатель видит отчёты мастера (общий заголовок «Ход работ»), без ссылки «Добавить отчёт» и без пустого состояния мастера", () => {
    const items = reportsView([{ id: "r1", title: "Корпус готов", text: "Собрал корпус", createdAt: new Date("2026-11-12T10:00:00Z"), photos: [{ id: "p1", src: "/f/p1.jpg" }] }]);
    const out = html(<DealCardView view={view({ reports: { items, addHref: null } })} device={device} />);
    expect(out).toContain(`>${t.reports.section}<`);
    expect(out).toContain("Собрал корпус");
    expect(out).toContain('src="/f/p1.jpg"');
    expect(out).not.toContain(tm.reports.add);
    expect(out).not.toContain(tm.reports.empty);
  });
});

describe("«Сдача работы» — фото результата и место сдачи", () => {
  const ready = { at: new Date("2026-11-20T10:00:00Z"), photos: [{ id: "p9", src: "/f/p9.jpg" }], distanceM: 36, withinRadius: true, radiusM: 500 };

  for (const device of ["mobile", "desktop"] as const) {
    it(`${device}: покупатель видит фото сдачи и «в пределах радиуса»`, () => {
      const out = html(<DealCardView view={view({ delivery: deliveryView(ready) })} device={device} />);
      expect(out).toContain(`>${t.delivery.section}<`);
      expect(out).toContain('src="/f/p9.jpg"');
      expect(out).toContain("Сдано у адреса заказа: 36 м, в пределах 500 м");
    });
  }

  it("дальше радиуса — предупреждение; не сдано — блока нет", () => {
    expect(text(<DealCardView view={view({ delivery: deliveryView({ ...ready, distanceM: 2021, withinRadius: false }) })} device="mobile" />)).toContain(
      "Сдано в 2021 м от адреса заказа — дальше 500 м",
    );
    expect(html(<DealCardView view={view({ delivery: null })} device="mobile" />)).not.toContain(t.delivery.section);
  });
});
