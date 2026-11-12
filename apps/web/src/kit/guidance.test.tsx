import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { brand } from "@/config/brand";
import { BackLink, Checkbox, EmptyState, FirstSteps, HelpBlock, NowNext, RadioCard, Section, WizardHeader } from "./index";
import { count, hasClass, html, text } from "./test-utils";

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

describe("заголовки блоков", () => {
  it("EmptyState, FirstSteps и HelpBlock рисуют h2, NowNext — один h2 и ни одного h1", () => {
    expect(html(<EmptyState title="Т" body="Б" />)).toContain("<h2");
    expect(html(<FirstSteps steps={[{ label: "А", done: false }]} />)).toContain("<h2");
    expect(html(<HelpBlock items={[]} supportEmail="a@b.kz" />)).toContain("<h2");
    const out = html(<NowNext now={{ title: "Ждём" }} next="Дальше-шаг" />);
    expect(count(out, "<h2")).toBe(1);
    expect(out).not.toContain("<h1");
  });

  it("у выполненного шага со ссылкой ссылки нет, у невыполненного есть", () => {
    const out = html(
      <FirstSteps
        steps={[
          { label: "Готов", done: true, href: "/v2/done" },
          { label: "Нет", done: false, href: "/v2/todo" },
        ]}
      />,
    );
    expect(out).not.toContain("/v2/done");
    expect(out).toContain('href="/v2/todo"');
  });
});

describe("HelpBlock", () => {
  it("адрес в mailto: кодируется, строка поддержки без шеврона", () => {
    const out = html(<HelpBlock items={[]} supportEmail="a b@c.kz" />);
    expect(out).toContain('href="mailto:a%20b@c.kz"');
    expect(out).not.toContain("lucide-chevron-right");
  });

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

  it("шаг зажат в [1, total]; при total <= 0 нет строки шага и прогресса, h1 остаётся", () => {
    expect(text(<WizardHeader step={9} total={5} title="Т" />)).toContain("Шаг 5 из 5");
    expect(text(<WizardHeader step={0} total={5} title="Т" />)).toContain("Шаг 1 из 5");
    expect(text(<WizardHeader step={-3} total={5} title="Т" />)).toContain("Шаг 1 из 5");
    const out = html(<WizardHeader step={1} total={0} title="Т" />);
    expect(out).not.toContain("progressbar");
    expect(out).not.toContain("Шаг");
    expect(count(out, "<h1")).toBe(1);
  });

  it("headingLevel={2} даёт h2 и ни одного h1", () => {
    const out = html(<WizardHeader step={1} total={3} title="Т" headingLevel={2} />);
    expect(count(out, "<h1")).toBe(0);
    expect(count(out, "<h2")).toBe(1);
    expect(hasClass(out.match(/<h2[^>]*>/)?.[0] ?? "", "text-title")).toBe(true);
  });

  it("«Назад» — видимая ссылка, когда задана; тот же BackLink, что у PageTitle", () => {
    expect(html(<WizardHeader step={1} total={3} title="Т" />)).not.toMatch(/<a\s/);
    const back = { href: "/v2/prev", label: "Заявка" };
    const out = html(<WizardHeader step={2} total={3} title="Т" back={back} />);
    expect(out).toContain('href="/v2/prev"');
    expect(out).toContain(html(<BackLink {...back} />));
    expect(out).not.toContain("text-accent");
  });
});

describe("EmptyState", () => {
  it("без действия нет главной кнопки", () => {
    expect(html(<EmptyState title="Пусто" body="Текст" />)).not.toContain("data-primary-action");
  });

  it("текст по центру и не шире 560 px — во всю ширину сетки строки не растягиваются", () => {
    const body = html(<EmptyState title="Пусто" body="Текст" />).match(/<p[^>]*>Текст<\/p>/)?.[0] ?? "";
    for (const cls of ["max-w-narrow", "mx-auto"]) expect(hasClass(body, cls), cls).toBe(true);
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
    expect(out).not.toContain("border-t");
  });

  it("«Дальше» — в той же карточке под разделителем: мелкая серая подпись, как «Сейчас», и текст обычным весом", () => {
    const out = html(<NowNext now={{ title: "Ждём" }} next="Приёмка" />);
    // Одна карточка: section открывается один раз и закрывается в самом конце.
    expect(out).toMatch(/^<section[^>]*>[\s\S]*<\/section>$/);
    expect(count(out, "<section")).toBe(1);
    const now = out.match(/<p[^>]*>Сейчас<\/p>/)?.[0] ?? "";
    const nextLabel = out.match(/<p[^>]*>Дальше<\/p>/)?.[0] ?? "";
    expect(nextLabel).not.toBe("");
    expect(nextLabel.replace("Дальше", "Сейчас")).toBe(now);
    const divider = out.match(/<div[^>]*border-t[^>]*>/)?.[0] ?? "";
    for (const cls of ["border-t", "border-line"]) expect(hasClass(divider, cls), cls).toBe(true);
    const body = out.match(/<p[^>]*>Приёмка<\/p>/)?.[0] ?? "";
    expect(hasClass(body, "text-ink")).toBe(true);
    expect(body).not.toMatch(/font-(?:medium|semibold)/);
    expect(out).not.toContain("Дальше:");
    expect(out).not.toContain("px-1");
  });
});

describe("HelpBlock: заголовок по левому краю карточки", () => {
  it("h2 «Помощь» без своих отступов; карточка — сразу под ним через зазор группы", () => {
    const out = html(<HelpBlock items={[]} supportEmail="a@b.kz" />);
    const h2 = out.match(/<h2[^>]*>/)?.[0] ?? "";
    expect(h2).not.toMatch(/[\s"](?:-?m|p)[xlrse]?-\d/);
    expect(out).not.toContain("px-1");
    expect(out).toContain(html(<Section title={ru.app.kit.help.title}>{null}</Section>).replace("</section>", ""));
  });
});

describe("brand.support", () => {
  it("адрес поддержки задан в конфиге", () => {
    expect(brand.support.email).toBe("sunrisefeex@gmail.com");
  });
});

describe("Checkbox: нарисованный флажок", () => {
  it("нативный input скрыт визуально (sr-only peer) и сохраняет атрибуты", () => {
    const out = html(<Checkbox label="Согласен" name="ok" value="1" disabled error="Нужно" aria-describedby="h" />);
    const input = out.match(/<input[^>]*>/)?.[0] ?? "";
    expect(hasClass(input, "sr-only")).toBe(true);
    expect(hasClass(input, "peer")).toBe(true);
    expect(input).toContain('type="checkbox"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toMatch(/aria-describedby="h [^"]+"/);
    expect(input).toMatch(/\sdisabled(=""|\s|\/|>)/);
    expect(input).toContain('name="ok"');
  });

  it("коробка с границей line-strong; при ошибке border-danger", () => {
    const ok = html(<Checkbox label="А" name="a" />);
    expect(hasClass(ok, "border-line-strong")).toBe(true);
    expect(hasClass(ok, "border-danger")).toBe(false);
    const bad = html(<Checkbox label="А" name="a" error="Нужно" />);
    expect(hasClass(bad, "border-danger")).toBe(true);
    expect(hasClass(bad, "border-line-strong")).toBe(false);
  });
});

describe("Checkbox: отключённый", () => {
  it("тускнеет весь элемент вместе с подписью, курсор not-allowed — как у RadioCard", () => {
    const out = html(<Checkbox label="Согласен" name="ok" disabled />);
    const label = out.match(/<label[^>]*>/)?.[0] ?? "";
    expect(hasClass(label, "has-disabled:opacity-50")).toBe(true);
    expect(hasClass(label, "has-disabled:cursor-not-allowed")).toBe(true);
    expect(out).not.toContain("peer-disabled:opacity-50");
  });
});

describe("RadioCard: нарисованный кружок", () => {
  it("input скрыт, кружок с границей line-strong", () => {
    const out = html(<RadioCard label="А" name="m" value="a" />);
    const input = out.match(/<input[^>]*>/)?.[0] ?? "";
    expect(hasClass(input, "sr-only")).toBe(true);
    expect(hasClass(input, "peer")).toBe(true);
    expect(hasClass(out, "border-line-strong")).toBe(true);
  });
});
