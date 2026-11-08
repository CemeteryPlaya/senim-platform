import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { DealProgress, FullscreenStep, MirrorPayout, RequestCard, SignedBadge, WorkCard } from "./index";

const FORBIDDEN = /комисси|эскроу/i;

describe("MirrorPayout", () => {
  const html = renderToStaticMarkup(<MirrorPayout payoutTiyn={139_200_000n} guaranteeTiyn={5_800_000n} />);
  const text = html.replace(/<[^>]+>/g, "").replace(/\u00a0/g, " ");

  it("показывает выплату и гарантию в тенге", () => {
    expect(text).toContain("1 392 000 ₸");
    expect(text).toContain("58 000 ₸");
  });
  it("тексты — из ru", () => {
    expect(text).toContain(ru.payments.mirror.title);
    expect(text).toContain("Гарантия оплаты и клиента (4%)");
    expect(text).toContain(ru.payments.mirror.guarantee);
  });
});

describe("WorkCard", () => {
  const html = renderToStaticMarkup(
    <WorkCard href="/w/1" photoUrl="/img/kitchen.svg" title="Кухня" priceFrom={1_200_000} meta={["Кухня", "30 дней"]} verified dealsCount={12} />,
  );
  it("цена «от», параметры, «Проверен», число сделок", () => {
    const text = html.replace(/<[^>]+>/g, "").replace(/\u00a0/g, " ");
    expect(text).toContain("от");
    expect(text).toContain("1 200 000 ₸");
    expect(text).toContain("30 дней");
    expect(text).toContain(ru.common.ui.workCard.verified);
    expect(text).toContain("12 сделок");
    expect(html).toContain('href="/w/1"');
  });
  it("имя ссылки — название работы, а не цена", () => {
    expect(html).toMatch(/<a [^>]*href="\/w\/1"[^>]*>Кухня<\/a>/);
  });
  it("без фото — заглушка, без цены — «по запросу»", () => {
    const bare = renderToStaticMarkup(<WorkCard href="/w" title="Работа" photoUrl={null} priceFrom={null} meta={[]} />);
    expect(bare).toContain(ru.common.ui.workCard.noPhoto);
    expect(bare).toContain(ru.common.ui.workCard.priceUnknown);
  });
});

describe("RequestCard", () => {
  it("«Новая» и число откликов", () => {
    const html = renderToStaticMarkup(<RequestCard href="/r/1" thumbUrl={null} title="Кухня 3,2 м" meta={["Алматы"]} isNew offersCount={5} />);
    expect(html).toContain(ru.common.ui.requestCard.isNew);
    expect(html).toContain("Откликов: 5");
    expect(html).toContain('href="/r/1"');
  });
  it("не новая — без метки", () => {
    const html = renderToStaticMarkup(<RequestCard href="/r/1" thumbUrl={null} title="Т" meta={[]} isNew={false} offersCount={0} />);
    expect(html).not.toContain(ru.common.ui.requestCard.isNew);
  });
});

describe("DealProgress", () => {
  it("упорядоченный список из пяти шагов, текущий — aria-current=step", () => {
    const html = renderToStaticMarkup(<DealProgress status="READY" hasOpenDispute={false} />);
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    const current = html.match(/<li[^>]*aria-current="step"[^>]*>.*?<\/li>/)?.[0] ?? "";
    expect(current).toContain(ru.common.ui.dealProgress.steps[3]);
    expect(current).toContain("Приёмка");
  });
  it("пройденные шаги озвучены скрытым текстом", () => {
    const html = renderToStaticMarkup(<DealProgress status="READY" hasOpenDispute={false} />);
    expect(html.match(new RegExp(`sr-only">${ru.common.ui.dealProgress.done}`, "g"))).toHaveLength(3);
  });
  it("средняя ширина: подпись текущего шага одной строкой («Шаг 4 из 5: Приёмка»), подписи в ряд — только на широком", () => {
    const html = renderToStaticMarkup(<DealProgress status="READY" hasOpenDispute={false} />);
    expect(html).toContain(ru.common.ui.dealProgress.caption(4, 5, "Приёмка"));
    expect(renderToStaticMarkup(<DealProgress status="SPLIT_PAYOUT" hasOpenDispute={false} />)).toContain(ru.common.ui.dealProgress.allDone);
  });
  it("спор: плашка и серые шаги", () => {
    const html = renderToStaticMarkup(<DealProgress status="PAID_HOLD" hasOpenDispute />);
    expect(html).toContain(ru.common.ui.dealProgress.dispute);
    expect(html).toContain('data-muted="true"');
    expect(html).toContain("<ol");
  });
  it("без спора шаги не серые", () => {
    expect(renderToStaticMarkup(<DealProgress status="PAID_HOLD" hasOpenDispute={false} />)).not.toContain("data-muted");
  });
  it("отмена и возврат — плашка без шагов", () => {
    const c = renderToStaticMarkup(<DealProgress status="CANCELLED" hasOpenDispute={false} />);
    expect(c).toContain(ru.common.ui.dealProgress.cancelled);
    expect(c).not.toContain("<ol");
    expect(renderToStaticMarkup(<DealProgress status="REFUNDED" hasOpenDispute={false} />)).toContain(ru.common.ui.dealProgress.refunded);
  });
});

describe("SignedBadge", () => {
  it("заголовок, дата и номер документа", () => {
    const html = renderToStaticMarkup(<SignedBadge signedAt={new Date("2026-11-12T10:00:00Z")} documentNumber="2026-1147" />);
    expect(html).toContain(ru.common.ui.signed.title);
    expect(html).toContain("12 ноября 2026");
    expect(html).toContain("2026-1147");
  });
});

describe("FullscreenStep", () => {
  const html = renderToStaticMarkup(
    <FullscreenStep title="Какой уровень?" back={{ href: "/back" }} action={<button data-primary-action>Далее</button>}>
      <p>Содержимое</p>
    </FullscreenStep>,
  );
  it("заголовок, содержимое, «Назад» ссылкой и одно действие", () => {
    expect(html).toContain("Какой уровень?");
    expect(html).toContain("Содержимое");
    expect(html).toContain('href="/back"');
    expect(html).toContain(ru.common.actions.back);
    expect(html.match(/data-primary-action/g)).toHaveLength(1);
  });
});

describe("слова-табу", () => {
  it("ни один компонент не выводит «комиссия»/«эскроу»", () => {
    const parts = [
      renderToStaticMarkup(<MirrorPayout payoutTiyn={1n} guaranteeTiyn={1n} />),
      renderToStaticMarkup(<WorkCard href="/" title="Работа" photoUrl={null} priceFrom={1} meta={[]} verified dealsCount={1} />),
      renderToStaticMarkup(<RequestCard href="/" thumbUrl={null} title="т" meta={[]} isNew offersCount={1} />),
      renderToStaticMarkup(<DealProgress status="PAID_HOLD" hasOpenDispute />),
      renderToStaticMarkup(<DealProgress status="CANCELLED" hasOpenDispute={false} />),
      renderToStaticMarkup(<SignedBadge signedAt={new Date()} documentNumber="1" />),
    ];
    for (const html of parts) expect(html).not.toMatch(FORBIDDEN);
  });
});
