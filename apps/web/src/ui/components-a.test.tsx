import { renderToStaticMarkup } from "react-dom/server";
import { Hammer, Sofa } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { CategoryTiles, FilterChips, KeyValueList, StatTiles, TrustNote } from "./index";

describe("CategoryTiles", () => {
  const html = renderToStaticMarkup(
    <CategoryTiles
      items={[
        { href: "/a", label: "Кухни", icon: Sofa },
        { href: "/b", label: "Шкафы", icon: Hammer },
      ]}
      moreHref="/all"
    />,
  );

  it("у каждой плитки есть видимая подпись и ссылка", () => {
    expect(html).toContain('href="/a"');
    expect(html).toContain(">Кухни<");
    expect(html).toContain(">Шкафы<");
  });

  it("значки скрыты от диктора и не заменяют подпись", () => {
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBe(3);
  });

  it("плитка «Все типы» берёт текст из ru, если подпись не передана", () => {
    expect(html).toContain('href="/all"');
    expect(html).toContain(`>${ru.common.ui.categoryTilesMore}<`);
  });

  it("сетка растягивает плитки: auto-fit, а не auto-fill", () => {
    expect(html).toContain("auto-fit");
    expect(html).not.toContain("auto-fill");
  });

  it("без moreHref плитки «Все типы» нет", () => {
    const none = renderToStaticMarkup(<CategoryTiles items={[{ href: "/a", label: "Кухни", icon: Sofa }]} />);
    expect(none).not.toContain(ru.common.ui.categoryTilesMore);
  });
});

describe("TrustNote", () => {
  it("мятная плашка с role=note и текстом", () => {
    const html = renderToStaticMarkup(<TrustNote>Деньги в банке под защитой</TrustNote>);
    expect(html).toContain('role="note"');
    expect(html).toContain("Деньги в банке под защитой");
    expect(html).toContain("bg-accent-soft");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("KeyValueList", () => {
  it("рисует dl с парами dt/dd", () => {
    const html = renderToStaticMarkup(
      <KeyValueList
        rows={[
          { label: "Город", value: "Астана" },
          { label: "Срок", value: <b>14 дней</b> },
        ]}
      />,
    );
    expect(html).toMatch(/^<dl[ >]/);
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html.match(/<dd/g)).toHaveLength(2);
    expect(html).toContain(">Город<");
    expect(html).toContain("<b>14 дней</b>");
  });
});

describe("StatTiles", () => {
  it("показывает значение, подпись и подсказку", () => {
    const html = renderToStaticMarkup(
      <StatTiles
        items={[
          { label: "Новые заявки", value: "3", hint: "за сегодня" },
          { label: "В работе", value: "5" },
        ]}
      />,
    );
    expect(html).toContain("Новые заявки");
    expect(html).toContain(">3<");
    expect(html).toContain("за сегодня");
    expect(html).toContain("auto-fit");
    expect(html).toContain("В работе");
  });
  it("подпись списка и плитка только для десктопа", () => {
    const html = renderToStaticMarkup(
      <StatTiles
        label="Сводка"
        items={[
          { label: "Новые заявки", value: "3" },
          { label: "Заработок за ноябрь", value: "1 ₸", desktopOnly: true },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Сводка"');
    const tiles = html.match(/<li[^>]*>/g) ?? [];
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).not.toContain("max-lg:hidden");
    expect(tiles[1]).toContain("max-lg:hidden");
  });
});

describe("FilterChips", () => {
  const html = renderToStaticMarkup(
    <FilterChips
      label="Показать работы"
      items={[
        { href: "/?c=all", label: "Все", active: true },
        { href: "/?c=kitchen", label: "Кухни", active: false },
      ]}
    />,
  );

  it("контейнер — nav с подписью", () => {
    expect(html).toMatch(/^<nav[^>]*aria-label="Показать работы"/);
  });

  it("aria-current=page только у активного", () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const current = (html.match(/<a [^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/?c=all"');
  });

  it("чипы — ссылки не ниже 48 px", () => {
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain("min-h-control-sm");
  });
});
