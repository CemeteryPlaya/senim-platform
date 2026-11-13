import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import { nowView, offersView, type OfferInput } from "./card-view";
import { RequestCardView, type CardView } from "./RequestCardView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), redirect: () => undefined }));
vi.mock("@/modules/identity", () => ({ requireUser: async () => ({}) }));
vi.mock("@/modules/requests", () => ({ cancelRequest: async () => undefined, cancelRequestSchema: { shape: {} }, OFFER_SORTS: ["price", "duration", "rating"] }));
vi.mock("@/platform/action", () => ({ action: () => async () => ({ ok: true }) }));

const t = ru.app.requestCard;

const offer = (id: string, price: bigint): OfferInput => ({
  id,
  status: "SENT",
  priceTiyn: price,
  durationDays: 20,
  warrantyMonths: 12,
  executor: { label: `Исполнитель №${id}`, ratingAvg: 4.5, reviewsCount: 3, completedDeals: 2 },
});

function view(over: Partial<CardView> = {}, offers: OfferInput[] = [offer("3", 100_000_00n), offer("5", 90_000_00n)]): CardView {
  const request = { id: "r1", status: "OPEN" as const, mode: "TENDER" as const };
  return {
    id: "r1",
    title: "Кухня",
    number: 18,
    sent: null,
    now: nowView({ ...request, offersCount: offers.length, dealId: null, chosenOfferId: null }),
    offers: offersView(request, offers, "price"),
    details: [{ label: "Город", value: "Астана", stacked: false }],
    photos: [{ id: "p1", src: "/f/p1", alt: "Фото помещения 1 из 1" }],
    cancel: { offersCount: offers.length, direct: false },
    ...over,
  };
}

const h1 = (out: string) => out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];

describe.each(["mobile", "desktop"] as const)("карточка заявки, %s", (device) => {
  it("один h1 — название заявки, номер вторичной строкой, «Назад: Заявки»", () => {
    const out = html(<RequestCardView view={view()} device={device} />);
    expect(count(out, "<h1")).toBe(1);
    expect(h1(out)).toBe("Кухня");
    expect(out).toContain(t.numberLine(18));
    expect(out).toContain('href="/v2/requests"');
  });

  it("предложения: карточки-ссылки, «Исполнитель №N», цена; сортировка из трёх сегментов, выбран «Дешевле»", () => {
    const out = html(<RequestCardView view={view()} device={device} />);
    expect(out).toContain('href="/v2/requests/r1/offers/3"');
    expect(out).toContain('href="/v2/requests/r1/offers/5"');
    expect(out).toContain("Исполнитель №3");
    expect(count(out, 'aria-pressed="true"')).toBe(1);
    expect(count(out, 'aria-pressed="false"')).toBe(2);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Дешевле/);
    expect(out).toContain(t.offers.section(2));
  });

  it("одно предложение — сортировки нет", () => {
    const out = html(<RequestCardView view={view({}, [offer("3", 1n)])} device={device} />);
    expect(out).not.toContain("aria-pressed");
  });

  it("главного действия нет (ждём или есть предложения): ни одного data-primary-action", () => {
    expect(count(html(<RequestCardView view={view()} device={device} />), "data-primary-action")).toBe(0);
  });

  it("пусто: обучающий экран без кнопки", () => {
    const out = html(<RequestCardView view={view({}, [])} device={device} />);
    expect(out).toContain(t.offers.empty.title);
    expect(count(out, "data-primary-action")).toBe(0);
    expect(out).not.toContain("aria-pressed");
  });

  it("сделка: одно главное действие «Открыть сделку» на сделку", () => {
    const request = { id: "r1", status: "CONTRACTING" as const, mode: "TENDER" as const };
    const now = nowView({ ...request, offersCount: 1, dealId: "d9", chosenOfferId: null });
    const out = html(<RequestCardView view={view({ now, offers: offersView(request, [offer("3", 1n)], "price"), cancel: null })} device={device} />);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toMatch(/data-primary-action[^>]*href="\/v2\/deals\/d9"|href="\/v2\/deals\/d9"[^>]*data-primary-action/);
    expect(out).toContain(t.now.deal.action);
  });

  it("меню «Действия» только когда отмена разрешена", () => {
    expect(html(<RequestCardView view={view()} device={device} />)).toContain(`aria-label="${t.actions.menu}"`);
    expect(html(<RequestCardView view={view({ cancel: null })} device={device} />)).not.toContain(t.actions.menu);
  });

  it("разовая плашка отправки", () => {
    const out = html(<RequestCardView view={view({ sent: { title: t.sent.title, text: t.sent.text, href: "/v2/requests/r1" } })} device={device} />);
    expect(out).toContain(t.sent.title);
  });

  it("фото — превью с описанием из данных", () => {
    const out = html(<RequestCardView view={view()} device={device} />);
    expect(out).toContain('alt="Фото помещения 1 из 1"');
    expect(out).toContain('src="/f/p1"');
  });

  it("устройство различают классами mobile:/desktop:, без sm:/md:/lg:", () => {
    expect(html(<RequestCardView view={view()} device={device} />)).not.toMatch(/class="[^"]*(?:^|\s)(?:sm|md|lg|xl):/);
  });
});

describe("раскладка по устройствам", () => {
  it("телефон: действие в ActionDock последним; компьютер: под «Сейчас», дока нет", () => {
    const request = { id: "r1", status: "CLOSED" as const, mode: "TENDER" as const };
    const now = nowView({ ...request, offersCount: 0, dealId: "d9", chosenOfferId: null });
    const v = view({ now, offers: offersView(request, [], "price"), cancel: null });
    const mobile = html(<RequestCardView view={v} device="mobile" />);
    const desktop = html(<RequestCardView view={v} device="desktop" />);
    expect(mobile.lastIndexOf("data-primary-action")).toBeGreaterThan(mobile.indexOf(t.details.section));
    expect(desktop.indexOf("data-primary-action")).toBeLessThan(desktop.indexOf(t.details.section));
  });
});
