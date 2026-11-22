import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { count, hasClass, html } from "@/kit/test-utils";
import { ABOUT_ANCHORS } from "../about/anchors";
import { GuestHome } from "./GuestHome";

const t = ru.app.guest.home;

/** Открывающий тег первого элемента, у которого есть атрибут или класс `marker`. */
const tagWith = (out: string, marker: string) => out.match(new RegExp(`<[a-z]+ [^>]*${marker}[^>]*>`))?.[0] ?? "";

describe("главная гостя (лендинг)", () => {
  for (const device of ["mobile", "desktop"] as const) {
    describe(device, () => {
      const out = html(<GuestHome device={device} />);

      it("один h1 — обещание продукта, без висящих слов (text-balance)", () => {
        expect(count(out, "<h1")).toBe(1);
        expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.title);
        expect(hasClass(out.match(/<h1[^>]*>/)?.[0] ?? "", "text-balance")).toBe(true);
      });

      it("одно главное действие «Заказать мебель»; ссылка мастера — на вход с другой ролью и не главная", () => {
        expect(count(out, "data-primary-action")).toBe(1);
        const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
        expect(primary?.[1]).toBe(t.clientAction);
        expect(primary?.[0]).toContain('href="/v2/login?role=client"');
        const master = out.match(/<a [^>]*href="\/v2\/login\?role=executor"[^>]*>(.*?)<\/a>/);
        expect(master?.[1].replace(/<[^>]*>/g, "")).toBe(t.executorLink);
        expect(master?.[0]).not.toContain("data-primary-action");
      });

      it("фото первого экрана — next/image из манифеста стенда, загружается заранее только оно; подпись временного фото честная", () => {
        expect(count(out, 'rel="preload"')).toBe(1);
        expect(out).toMatch(/<link rel="preload" as="image" imageSrcSet="[^"]*hero-kitchen-oak\.webp/);
        expect(out).toMatch(/<img [^>]*sizes="100vw"[^>]*srcSet="[^"]*hero-kitchen-oak\.webp/);
        // Остальные картинки — ленивые.
        const lazy = out.match(/<img [^>]*loading="lazy"/g) ?? [];
        expect(lazy.length).toBe(count(out, "<img") - 1);
        expect(out).toContain(t.photoCaption.temporary);
        expect(out).not.toContain(t.photoCaption.work);
      });

      it("капсула доверия на стекле glass-clear поверх затемнённого фото", () => {
        const capsule = tagWith(out, "glass-clear");
        expect(capsule).not.toBe("");
        expect(out.slice(out.indexOf(capsule))).toContain(t.trustCapsule);
        expect(out).toMatch(/class="(scrim-hero|scrim-photo)"/);
      });

      it("ниже первого экрана по порядку: факты, «Как это работает», «Где ваши деньги», работы, «Помощь», подвал", () => {
        const order = [
          out.indexOf(t.facts[0].value),
          out.indexOf(`>${t.stepsTitle}</h2>`),
          out.indexOf(`>${t.trustTitle}</h2>`),
          out.indexOf(`>${ru.app.guest.catalog.title}</h2>`),
          out.indexOf(`>${ru.app.kit.help.title}</h2>`),
          out.indexOf("<footer"),
        ];
        expect(order.every((i) => i > out.indexOf("<h1"))).toBe(true);
        expect([...order].sort((x, y) => x - y)).toEqual(order);
        for (const fact of t.facts) expect(out).toContain(`>${fact.value}</p>`);
      });

      it("три шага: снимок нашего экрана в рамке телефона, номер крупно, для читалки — «Шаг N»", () => {
        expect(t.steps).toHaveLength(3);
        expect(count(out, "phone-frame")).toBe(3);
        for (const [i, step] of t.steps.entries()) {
          expect(out).toContain(`>${step.title}</h3>`);
          expect(out).toContain(`<span class="sr-only">${t.stepLabel(i + 1)}</span>`);
          expect(out).toContain(`alt="${t.stepShots[i]}"`);
        }
        for (const file of ["request-new", "request-offers", "deal-money"]) expect(out).toContain(`%2Fapp-screens%2F${file}.webp`);
      });

      it("«Где ваши деньги» — тёмный раздел в обеих темах: схема «Вы → банк → мастер», пример суммы и пояснение", () => {
        const section = tagWith(out, 'data-theme="dark"');
        expect(section).toMatch(/^<section /);
        expect(hasClass(section, "bg-surface")).toBe(true);
        expect(count(out, 'data-theme="dark"')).toBe(1);
        for (const node of t.flow) expect(out).toContain(`>${node.label}</p>`);
        expect(out).toContain(formatMoney(200_000n * 100n));
        expect(out).not.toContain(formatMoney(204_000n * 100n));
        expect(out).toContain(t.explainLabel);
        for (const text of t.trustParagraphs) expect(out).toContain(text);
      });

      it("лента работ: 8 фото со ссылкой в каталог по типу и «Смотреть все»", () => {
        const tiles = [...out.matchAll(/<a [^>]*href="\/v2\/catalog\?type=([a-z-]+)"/g)].map((m) => m[1]);
        expect(tiles).toHaveLength(8);
        expect(out).toMatch(new RegExp(`<a [^>]*href="/v2/catalog"[^>]*>${t.worksAll}`));
      });

      it("«Помощь» — три вопроса аккордеоном, в ответах ссылки на разделы «О сервисе», ниже — поддержка", () => {
        expect(count(out, "<details")).toBe(3);
        for (const q of [t.helpMoney, t.helpPrice, t.helpRefusal]) expect(out).toMatch(new RegExp(`<summary[^>]*>${q.replace("?", "\\?")}`));
        const helpLinks = [...out.matchAll(/<a [^>]*href="(\/v2\/about#[a-z]+)"/g)].map((m) => m[1]);
        expect(helpLinks).toEqual([`/v2/about#${ABOUT_ANCHORS.money}`, `/v2/about#${ABOUT_ANCHORS.price}`, `/v2/about#${ABOUT_ANCHORS.refusal}`]);
        expect(out).toContain(`>${ru.app.kit.help.contact}</a>`);
      });
    });
  }

  it("компьютер: фото на всю ширину без 100vw, под шапкой, заголовок 64 px белым, главная кнопка белая (inverse), дока нет", () => {
    const out = html(<GuestHome device="desktop" />);
    // Корень — data-landing (область содержимого оболочки во всю ширину, landing.css); первый экран — w-full.
    expect(out).toMatch(/^<link [^>]*\/><div data-landing="true"/);
    const hero = tagWith(out, "data-hero");
    for (const cls of ["hero-fold", "w-full"]) expect(hasClass(hero, cls)).toBe(true);
    expect(out).not.toMatch(/(?<![\w-])bleed/); // утилиты 100vw больше нет (rail-bleed телефона — другое)
    expect(out).toContain('class="hero-fade"');
    const h1 = out.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(hasClass(h1, "desktop:text-display-xl")).toBe(true);
    expect(hasClass(h1, "text-on-photo")).toBe(true);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>/)?.[0] ?? "";
    expect(hasClass(primary, "bg-on-photo")).toBe(true);
    expect(out.indexOf("data-primary-action")).toBeLessThan(out.indexOf("</section>"));
    expect(out).not.toContain("data-action-dock");
    // Капсула — полная версия через «·».
    expect(out).toContain(`${t.trustCapsule} · ${t.trustCapsuleMore}`);
  });

  it("компьютер: факты и шаги, работы, «Помощь» и подвал — в колонке содержимого; тёмный раздел — от края до края", () => {
    const out = html(<GuestHome device="desktop" />);
    const columns = out.match(/<div class="mx-auto flex w-full max-w-content flex-col gap-24 px-6">/g) ?? [];
    expect(columns).toHaveLength(2);
    expect(hasClass(tagWith(out, 'data-theme="dark"'), "desktop:w-full")).toBe(true);
  });

  it("факты — блоки с весом: карточка, значок 24 px ink в нейтральном круге (зелёный — деньгам), значение title-2, пояснение 17 px", () => {
    for (const device of ["mobile", "desktop"] as const) {
      const out = html(<GuestHome device={device} />);
      for (const fact of t.facts) {
        expect(out).toContain(`<p class="text-title-2 text-ink">${fact.value}</p>`);
        expect(out).toContain(`<p class="text-body text-muted">${fact.note}</p>`);
      }
      expect(count(out, "rounded-card bg-surface p-5")).toBe(3);
      const facts = out.slice(out.indexOf(`aria-label="${t.factsLabel}"`), out.indexOf(`>${t.stepsTitle}</h2>`));
      expect(count(facts, "rounded-full bg-fill text-ink")).toBe(3);
      expect(facts).not.toMatch(/accent/);
    }
  });

  it("шаги на компьютере: рамка телефона 19,5rem сверху, заголовок шага 22 px", () => {
    const out = html(<GuestHome device="desktop" />);
    expect(count(out, "mx-auto w-78")).toBe(3);
    expect(count(out, 'sizes="20rem"')).toBe(3);
    for (const step of t.steps) expect(out).toContain(`<h3 class="min-w-0 text-title-2 text-ink">${step.title}</h3>`);
    const steps = out.slice(out.indexOf(`>${t.stepsTitle}</h2>`));
    expect(steps.indexOf("phone-frame")).toBeLessThan(steps.indexOf(`>${t.steps[0].title}</h3>`));
  });

  it("шаги на телефоне — столбиком: номер и заголовок, абзац на всю ширину, ниже снимок 70 % по центру", () => {
    const out = html(<GuestHome device="mobile" />);
    expect(count(out, "mx-auto w-7/10")).toBe(3);
    expect(count(out, 'sizes="70vw"')).toBe(3);
    const steps = out.slice(out.indexOf(`>${t.stepsTitle}</h2>`));
    for (const [i, step] of t.steps.entries()) {
      const at = steps.indexOf(`>${step.title}</h3>`);
      const body = steps.indexOf(`>${step.text}</p>`);
      const shot = steps.indexOf(`alt="${t.stepShots[i]}"`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(body);
      expect(body).toBeLessThan(shot);
    }
  });

  it("телефон: название продукта над заголовком 36 px, сразу фото 4:5 со скруглением 24, капсула у нижнего края фото, подпись — отдельно под фото; подзаголовок под фото; кнопка — в доке последней", () => {
    const out = html(<GuestHome device="mobile" />);
    expect(out.indexOf(`>${ru.common.brand}</p>`)).toBeLessThan(out.indexOf("<h1"));
    const h1 = out.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(hasClass(h1, "text-hero-mobile")).toBe(true);
    expect(hasClass(h1, "wrap-break-word")).toBe(false);
    const photo = tagWith(out, "aspect-4/5");
    expect(hasClass(photo, "rounded-hero")).toBe(true);
    expect(hasClass(photo, "photo-frame")).toBe(true);
    // Капсула — у нижнего края фото над затемнением снизу; подпись — не на фото, а под ним справа, тихим текстом.
    const frame = out.slice(out.indexOf(photo));
    expect(frame.indexOf('class="scrim-photo"')).toBeLessThan(frame.indexOf(t.trustCapsule));
    expect(frame).toContain('<div class="absolute inset-x-3 bottom-3 flex">');
    expect(out).toContain(`<figcaption class="self-end text-small text-muted">${t.photoCaption.temporary}</figcaption>`);
    expect(out.indexOf(photo)).toBeLessThan(out.indexOf(`>${t.lead}</p>`));
    // Тёмный раздел — за поля колонки, растяжением без w-full (иначе он шириной колонки, сдвинутый влево).
    const dark = tagWith(out, 'data-theme="dark"');
    expect(hasClass(dark, "mobile:rail-bleed")).toBe(true);
    expect(hasClass(dark, "w-full")).toBe(false);
    expect(dark).toContain("data-landing-money");
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(count(dock, "<a ")).toBe(1);
    expect(dock).toContain("data-primary-action");
    expect(out.indexOf("data-primary-action")).toBeGreaterThan(out.indexOf("<footer"));
    expect(out.indexOf("role=executor")).toBeLessThan(out.indexOf(`>${t.stepsTitle}</h2>`));
    expect(out.indexOf("role=executor")).toBeGreaterThan(out.indexOf("<h1"));
  });

  it("в текстах нет запретных слов и слова «приёмка»; предлог «в» в заголовке не отрывается", () => {
    const all = JSON.stringify(ru.app.guest.home) + JSON.stringify(ru.app.guest.about);
    expect(all).not.toMatch(/эскроу|комисси|демо|тестов/i);
    expect(JSON.stringify(ru.app.guest.home)).not.toMatch(/приёмк/i);
    expect(all).not.toMatch(/Защита сделки|2\s?%\)/);
    expect(all).toContain("без доплат");
    expect(t.title).toContain("в банке");
    expect(JSON.stringify(t.facts)).toContain("Не проходят через счета сервиса");
  });
});
