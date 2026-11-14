import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { count, html } from "@/kit/test-utils";
import type { DealListItem } from "@/modules/deal-core";
import type { IncomingListItem } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { MasterHomeView, type MasterHomeData } from "./MasterHomeView";
import { masterHome, type MasterHomeInput } from "./master-home";

const t = ru.app.masterRequests.home;

const dealItem = (over: Partial<DealListItem> = {}): DealListItem => ({
  id: "d1",
  number: 1,
  title: "Кухня угловая",
  status: "PAID_HOLD",
  isDemo: false,
  paymentProvider: "MOCK",
  priceTiyn: 120_000_000n,
  estimate: { party: "EXECUTOR", priceTiyn: 120_000_000n, extraTiyn: 4_800_000n, totalTiyn: 115_200_000n },
  money: { kind: "protected", amountTiyn: 122_400_000n, reservedAt: new Date("2026-11-01T10:00:00Z"), operationRef: null, bankBalanceTiyn: 122_400_000n, isTest: false },
  hasOpenDispute: false,
  executorLabel: "Исполнитель №3",
  updatedAt: new Date("2026-11-02T10:00:00Z"),
  myRole: "EXECUTOR",
  ...over,
});

const fresh = (id: string): IncomingListItem => ({
  id,
  number: 7,
  title: "Шкаф",
  mode: "DIRECT",
  segment: "COMFORT",
  style: null,
  city: "Астана",
  desiredDate: null,
  publishedAt: new Date("2026-11-13T10:00:00Z"),
  offersCount: 0,
  myOfferStatus: null as never, // тип модуля не знает про null (r.offers[0]?.status ?? null), а значение бывает
  cover: null,
});

function data(input: Partial<MasterHomeInput>, over: Partial<MasterHomeData> = {}): MasterHomeData {
  const view = masterHome({ deals: [], counters: [], freshCount: 0, docs: { kyc: "VERIFIED", payoutSet: true }, ...input });
  return { view, deals: [], moreDeals: 0, fresh: [], stats: { fresh: 0, inWork: 0, earnedTiyn: 0n }, ...over };
}

const render = (d: MasterHomeData, device: Device) => html(<MasterHomeView data={d} name="Ерлан" device={device} />);

const SCREENS: { name: string; data: MasterHomeData; label: string | null; href?: string }[] = [
  {
    name: "сделка ждёт запуска",
    data: data(
      { deals: [{ id: "d1", title: "Кухня угловая", status: "PAID_HOLD", hasOpenDispute: false, next: { action: "startWork", mine: true }, consentMissing: false }] },
      { deals: [{ item: dealItem(), next: { action: "startWork", mine: true }, consentMissing: false }], stats: { fresh: 0, inWork: 1, earnedTiyn: 8_000_000n } },
    ),
    label: t.now.start.action,
    href: "/v2/deals/d1",
  },
  {
    name: "новые заявки",
    data: data({ freshCount: 2 }, { fresh: [fresh("r1"), fresh("r2")], stats: { fresh: 2, inWork: 0, earnedTiyn: 0n } }),
    label: t.now.fresh.action,
    href: "/v2/executor/requests?f=new",
  },
  { name: "пусто", data: data({}), label: null },
  { name: "документы на проверке", data: data({ docs: { kyc: "PENDING", payoutSet: true } }), label: null },
];

describe.each(["mobile", "desktop"] as const)("главная мастера (%s)", (device) => {
  it.each(SCREENS)("$name: один h1, главное действие и адрес", ({ data: d, label, href }) => {
    const out = render(d, device);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(label ? 1 : 0);
    if (label) {
      const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
      expect(primary?.[1]).toBe(label);
      if (href) expect(primary?.[0]).toContain(`href="${href}"`);
    }
  });

  it("сводка: число новых, в работе и сумма за месяц; сумм покупателя нет", () => {
    const out = render(SCREENS[0]!.data, device);
    expect(out).toContain(t.stats.earned);
    expect(out).toContain(formatMoney(8_000_000n));
    expect(out).toContain(ru.app.master.deal.line.protected);
    // 122 400 ₸-подобная сумма «в банке» (с защитой покупателя) мастеру не показывается: только его «вы получите».
    expect(out).not.toContain(formatMoney(122_400_000n));
    expect(out).toContain(formatMoney(115_200_000n));
  });

  it("новые заявки: строки-ссылки на заявку и «Все заявки»", () => {
    const out = render(SCREENS[1]!.data, device);
    expect(out).toContain('href="/v2/executor/requests/r1"');
    expect(out).toContain(ru.app.masterRequests.incoming.card.direct);
    expect(out).toContain(t.requests.all);
  });
});
