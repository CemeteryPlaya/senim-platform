import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { brand } from "@/config/brand";
import { EmptyState, FirstSteps, HelpBlock, NowNext, WizardHeader } from "./index";

const html = (el: ReactElement): string => renderToStaticMarkup(el);
const text = (el: ReactElement): string => html(el).replace(/<[^>]*>/g, "");
const count = (out: string, needle: string): number => out.split(needle).length - 1;

describe("FirstSteps", () => {
  it("пустой список и все шаги выполнены — ничего не рисует", () => {
    expect(html(<FirstSteps steps={[]} />)).toBe("");
    expect(html(<FirstSteps steps={[{ label: "А", done: true }]} />)).toBe("");
  });

  it("заголовок согласован по числу оставшихся шагов", () => {
    expect(text(<FirstSteps steps={[{ label: "А", done: true }, { label: "Б", done: false }]} />)).toContain("Остался 1 шаг");
    expect(text(<FirstSteps steps={[{ label: "А", done: false }, { label: "Б", done: false }]} />)).toContain("Осталось 2 шага");
  });

  it("рисует полосу прогресса по выполненным шагам и все подписи", () => {
    const out = html(
      <FirstSteps
        steps={[
          { label: "Первый", done: true },
          { label: "Второй", done: false, href: "/v2/next" },
        ]}
      />,
    );
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="1"');
    expect(out).toContain('aria-valuemax="2"');
    expect(out).toContain("Первый");
    expect(out).toContain('href="/v2/next"');
  });

  it("выполненный шаг помечен для диктора, невыполненный нет", () => {
    const out = html(
      <FirstSteps
        steps={[
          { label: "Готово", done: true },
          { label: "Нет", done: false },
        ]}
      />,
    );
    expect(count(out, ru.app.kit.firstSteps.doneMark)).toBe(1);
  });

  it("склонение: пары и граничные числа", () => {
    const left = ru.app.kit.firstSteps.left;
    expect(left(1)).toBe("Остался 1 шаг");
    expect(left(2)).toBe("Осталось 2 шага");
    expect(left(4)).toBe("Осталось 4 шага");
    expect(left(5)).toBe("Осталось 5 шагов");
    expect(left(11)).toBe("Осталось 11 шагов");
    expect(left(12)).toBe("Осталось 12 шагов");
    expect(left(21)).toBe("Остался 21 шаг");
    expect(left(22)).toBe("Осталось 22 шага");
    expect(left(25)).toBe("Осталось 25 шагов");
    expect(left(101)).toBe("Остался 101 шаг");
    expect(left(111)).toBe("Осталось 111 шагов");
  });
});

describe("HelpBlock", () => {
  it("последняя строка — письмо в поддержку", () => {
    const out = html(<HelpBlock items={[]} supportEmail="a@b.kz" />);
    expect(out).toContain('href="mailto:a@b.kz"');
    expect(out).toContain(ru.app.kit.help.title);
    expect(out).toContain(ru.app.kit.help.contact);
  });

  it("вопросы идут ссылками, письмо — после них", () => {
    const out = html(
      <HelpBlock
        items={[
          { question: "Где деньги?", href: "/v2/help/money" },
          { question: "Что со спором?", href: "/v2/help/dispute" },
        ]}
        supportEmail="a@b.kz"
      />,
    );
    expect(out).toContain('href="/v2/help/money"');
    expect(out.indexOf("Где деньги?")).toBeLessThan(out.indexOf("Что со спором?"));
    expect(out.indexOf("Что со спором?")).toBeLessThan(out.indexOf("mailto:a@b.kz"));
  });
});

describe("WizardHeader", () => {
  it("«Шаг N из M», прогресс и единственный h1", () => {
    const out = html(<WizardHeader step={2} total={5} title="Почта" />);
    expect(text(<WizardHeader step={2} total={5} title="Почта" />)).toContain("Шаг 2 из 5");
    expect(out).toContain('aria-valuenow="2"');
    expect(out).toContain('aria-valuemax="5"');
    expect(count(out, "<h1")).toBe(1);
    expect(out).toContain("Почта");
  });

  it("«Назад» — видимая ссылка, когда задана", () => {
    expect(html(<WizardHeader step={1} total={3} title="Т" />)).not.toContain("<a");
    const out = html(<WizardHeader step={2} total={3} title="Т" back={{ href: "/v2/prev", label: "Назад" }} />);
    expect(out).toContain('href="/v2/prev"');
    expect(out).toContain("Назад");
  });
});

describe("EmptyState", () => {
  it("без действия нет главной кнопки", () => {
    expect(html(<EmptyState title="Пусто" body="Текст" />)).not.toContain("data-primary-action");
  });

  it("с действием — одна главная ссылка-кнопка", () => {
    const out = html(<EmptyState title="Пусто" body="Текст" action={{ href: "/v2/requests/new", label: "Создать" }} />);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toContain('href="/v2/requests/new"');
    expect(out).toContain("Создать");
  });
});

describe("NowNext", () => {
  it("«Сейчас» с текстом и, если задано, «Дальше»", () => {
    const out = text(<NowNext now={{ title: "Мастер делает кухню", body: "От вас ничего не нужно." }} next="Приёмка" />);
    expect(out).toContain(ru.app.kit.nowNext.now);
    expect(out).toContain("Мастер делает кухню");
    expect(out).toContain("От вас ничего не нужно.");
    expect(out).toContain(ru.app.kit.nowNext.next);
    expect(out).toContain("Приёмка");
  });

  it("без next нет строки «Дальше»; нет и h1 (заголовок экрана не здесь)", () => {
    const out = html(<NowNext now={{ title: "Ждём" }} />);
    expect(out).not.toContain(ru.app.kit.nowNext.next);
    expect(out).not.toContain("<h1");
  });
});

describe("brand.support", () => {
  it("адрес поддержки задан в конфиге", () => {
    expect(brand.support.email).toBe("sunrisefeex@gmail.com");
  });
});
