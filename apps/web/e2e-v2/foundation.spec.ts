import { expect, test, type Locator, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";

/**
 * Каркас нового интерфейса (/v2): версия по заголовкам, оболочки, тема, накладки kit, заглушка раздела.
 * Данные не меняются. Подписи — только из ru. Проект mobile — Pixel 7, desktop — Desktop Chrome.
 */

const shell = ru.app.shell;
const showcase = ru.app.kit.showcase;
const overlays = showcase.overlays;
const NAV = shell.navLabel;
const UI_KIT = "/v2/ui-kit";

const button = (scope: Page | Locator, name: string) => scope.getByRole("button", { name, exact: true });

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("у элемента нет рамки");
  return b;
}

function viewportOf(page: Page) {
  const v = page.viewportSize();
  if (!v) throw new Error("нет размера окна");
  return v;
}

/**
 * Негативная проверка («окно не закрылось», «второго тоста нет»): наблюдаемого события нет, ждать нечего. Вместо одной
 * проверки после слепой паузы условие проверяется каждые 50 мс в течение `ms` и падает на первом же нарушении.
 */
async function holds(check: () => Promise<void>, ms = 500) {
  const end = Date.now() + ms;
  do {
    await check();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < end);
}

/** Короткий срок для проверок внутри `holds`: нарушение должно находиться сразу, а не через 30 секунд. */
const NOW = { timeout: 100 };

/** Фокус внутри элемента (а не на странице за ним). */
const focusInside = (el: Locator) => el.evaluate((node) => node.contains(document.activeElement));

// ───────── 1–3. Версия и оболочка ─────────

test.describe("оболочка телефона", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");

  test("1. навигация внизу экрана, верхней шапки нет", async ({ page }) => {
    await page.goto("/v2");
    await expect(page.locator("html")).toHaveAttribute("data-device", "mobile");
    const nav = page.getByRole("navigation", { name: NAV });
    await expect(nav).toBeVisible();
    const b = await box(nav);
    expect(b.y + b.height).toBeGreaterThanOrEqual(viewportOf(page).height - 40);
    expect(b.y + b.height).toBeLessThanOrEqual(viewportOf(page).height + 1);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.locator("[data-top-bar]")).toHaveCount(0);
    // Гость: Главная · Мастера · О сервисе · Войти.
    const tabs = nav.getByRole("link");
    await expect(tabs).toHaveText([shell.nav.home, shell.nav.masters, shell.nav.about, shell.nav.login]);
  });
});

test.describe("оболочка компьютера", () => {
  test.skip(({ isMobile }) => isMobile, "только проект desktop");

  test("2. шапка сверху, нижней панели нет", async ({ page }) => {
    await page.goto("/v2");
    await expect(page.locator("html")).toHaveAttribute("data-device", "desktop");
    const header = page.locator("[data-top-bar]");
    await expect(header).toBeVisible();
    expect((await box(header)).y).toBeLessThanOrEqual(1);
    await expect(page.locator("[data-tab-bar]")).toHaveCount(0);
    const nav = header.getByRole("navigation", { name: NAV });
    await expect(nav.getByRole("link")).toHaveText([shell.nav.masters, shell.nav.about]);
    await expect(header.getByRole("link", { name: shell.nav.login, exact: true })).toBeVisible();
  });

  test.describe("узкое окно", () => {
    test.use({ viewport: { width: 480, height: 800 } });

    test("3. 480×800: по-прежнему компьютерная версия с шапкой сверху", async ({ page }) => {
      await page.goto("/v2");
      await expect(page.locator("html")).toHaveAttribute("data-device", "desktop");
      const header = page.locator("[data-top-bar]");
      await expect(header).toBeVisible();
      expect((await box(header)).y).toBeLessThanOrEqual(1);
      await expect(page.locator("[data-tab-bar]")).toHaveCount(0);
    });
  });
});

// ───────── 4. Тема ─────────

test.describe("тема", () => {
  const BLACK = "rgb(0, 0, 0)";
  const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test("4a. кука theme=dark: data-theme и чёрный фон", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "theme", value: "dark", url: baseURL }]);
    await page.goto("/v2");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(BLACK);
  });

  test("4b. кука с чужим значением: атрибута нет, страница отвечает 200", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "theme", value: "<script>", url: baseURL }]);
    const response = await page.goto("/v2");
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  });

  test.describe("системная тёмная", () => {
    test.use({ colorScheme: "dark" });

    test("4c. без куки фон тоже чёрный", async ({ page }) => {
      await page.goto("/v2");
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      expect(await bodyBackground(page)).toBe(BLACK);
    });
  });
});

// ───────── 5. Шторка (телефон) ─────────

test.describe("шторка", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");

  test("5. фокус внутри, Tab не выходит, Escape закрывает и возвращает фокус", async ({ page }) => {
    await page.goto(UI_KIT);
    const opener = button(page, overlays.sheetOpen);
    await opener.click();
    const sheet = page.getByRole("dialog", { name: overlays.sheetTitle });
    await expect(sheet).toBeVisible();
    await expect.poll(() => focusInside(sheet)).toBe(true);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInside(sheet), `Tab ${i + 1}: фокус вышел из шторки`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

// ───────── 6. Диалог подтверждения (компьютер) ─────────

test.describe("диалог", () => {
  test.skip(({ isMobile }) => isMobile, "только проект desktop");

  test("6. ConfirmDialog: фокус внутри, Tab по кругу, Escape возвращает фокус", async ({ page }) => {
    await page.goto(UI_KIT);
    const opener = button(page, overlays.confirmOpen);
    await opener.click();
    const dialog = page.getByRole("dialog", { name: overlays.confirmTitle });
    await expect(dialog).toBeVisible();
    await expect.poll(() => focusInside(dialog)).toBe(true);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInside(dialog), `Tab ${i + 1}: фокус вышел из диалога`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

// ───────── 7. Уменьшенное движение ─────────

test.describe("уменьшенное движение", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");
  test.use({ reducedMotion: "reduce" });

  test("7. шторка открывается и встаёт на место (низ шторки — низ окна)", async ({ page }) => {
    await page.goto(UI_KIT);
    await button(page, overlays.sheetOpen).click();
    const sheet = page.getByRole("dialog", { name: overlays.sheetTitle });
    await expect(sheet).toBeVisible();
    const height = viewportOf(page).height;
    await expect
      .poll(async () => Math.abs((await box(sheet)).y + (await box(sheet)).height - height), { timeout: 5_000 })
      .toBeLessThanOrEqual(4);
  });
});

// ───────── 8. Крупный шрифт на узком телефоне ─────────

test.describe("шрифт 200% при 360 px", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");
  test.use({ viewport: { width: 360, height: 740 } });

  test("8. нет горизонтальной прокрутки, подписи вкладок не обрезаны", async ({ page }) => {
    await page.goto("/v2");
    await page.addStyleTag({ content: "html{font-size:200%}" });
    // Стиль действительно применился: 200% от 16 px. Иначе проверки ниже прошли бы и без увеличения шрифта.
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
    const nav = page.getByRole("navigation", { name: NAV });
    await expect(nav).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, "страница шире окна").toBeLessThanOrEqual(overflow.client);
    const labels = await page.locator("[data-tab-label]").evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent ?? "", scroll: el.scrollWidth, client: el.clientWidth })),
    );
    expect(labels).toHaveLength(4);
    for (const label of labels) expect(label.scroll, `подпись «${label.text}» обрезана`).toBeLessThanOrEqual(label.client);
  });
});

// ───────── 9, 15. Заглушка раздела ─────────

test.describe("заглушка раздела", () => {
  test("9. /v2/deals/1 — заглушка со ссылкой на /deals/1", async ({ page }) => {
    await page.goto("/v2/deals/1");
    await expect(page.getByRole("heading", { level: 1, name: shell.movingTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: shell.openOld })).toHaveAttribute("href", "/deals/1");
  });

  test("15a. параметры адреса сохраняются в ссылке", async ({ page }) => {
    await page.goto("/v2/deals/1?tab=money");
    await expect(page.getByRole("link", { name: shell.openOld })).toHaveAttribute("href", "/deals/1?tab=money");
  });

  test("15b. /v2//example.com: Next нормализует адрес, ссылка ведёт на /example.com, а не на чужой сайт", async ({ page }) => {
    await page.goto("/v2//example.com");
    // Наблюдаемый итог (Next 16.4.3): двойной слеш схлопывается ещё до страницы, адрес становится /v2/example.com.
    expect(new URL(page.url()).pathname).toBe("/v2/example.com");
    const link = page.getByRole("link", { name: shell.openOld });
    await expect(link).toBeVisible();
    // Страховка самой заглушки (пустые сегменты отбрасываются) проверена модульным тестом page.test.tsx.
    await expect(link).toHaveAttribute("href", "/example.com");
    expect((await link.getAttribute("href"))?.startsWith("//")).toBe(false);
  });

  // Сегмент с закодированными «//» и «\»: что бы ни сделал сервер (404, переадресация или заглушка), ссылка заглушки,
  // если она есть, не уводит на другой сайт.
  for (const path of ["/v2/%2F%2Fexample.com", "/v2/%5Cexample.com"]) {
    test(`15c. ${path}: ссылка заглушки остаётся на этом сайте`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      const links = page.getByRole("link", { name: shell.openOld });
      for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href") ?? ""))) {
        expect(new URL(href, page.url()).host, href).toBe(new URL(page.url()).host);
      }
    });
  }
});

// ───────── 17. Страница не найдена в v2 ─────────

test("17. notFound() под /v2: русская страница «не найдена» внутри оболочки v2, статус 404", async ({ page }) => {
  // Настоящий notFound() из страницы под (app): витрина вызывает его при ?missing=1 (только в dev).
  const response = await page.goto(`${UI_KIT}?missing=1`);
  expect(response?.status()).toBe(404);
  await expect(page.locator("html[data-device]")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: shell.notFoundTitle })).toBeVisible();
  await expect(page.getByText(shell.notFoundBody)).toBeVisible();
  const primary = page.locator("[data-primary-action]");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("href", "/v2");
  await expect(primary).toHaveText(shell.notFoundAction);
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
});

// ───────── 10, 11. Главное действие и заголовок ─────────

test("10. на /v2 ровно одно главное действие", async ({ page }) => {
  await page.goto("/v2");
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);
});

test("11. на /v2 и /v2/ui-kit ровно один <h1>", async ({ page }) => {
  for (const path of ["/v2", UI_KIT]) {
    await page.goto(path);
    await expect(page.locator("h1"), path).toHaveCount(1);
  }
});

// ───────── 12. ConfirmDialog ─────────

test.describe("ConfirmDialog на витрине", () => {
  test("12a. фокус на «Отмене», повтор гасится, Escape в ожидании не закрывает, потом закрывается и фокус на кнопке", async ({ page }) => {
    await page.goto(UI_KIT);
    const opener = button(page, overlays.confirmOpen);
    await opener.click();
    const dialog = page.getByRole("dialog", { name: overlays.confirmTitle });
    await expect(dialog).toBeVisible();
    const cancel = button(dialog, ru.app.kit.cancel);
    const confirm = button(dialog, overlays.confirmLabel);
    await expect(cancel).toBeFocused();
    await expect(confirm).not.toBeFocused();

    await confirm.click();
    await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(1);
    // Повторное нажатие: aria-disabled снимает проверки Playwright, поэтому — событием напрямую.
    // Что второе нажатие ничего не запускает, доказывает 12b: там onConfirm вызывает тост, и тост ровно один.
    await dialog.locator('[aria-busy="true"]').dispatchEvent("click");
    await page.keyboard.press("Escape");
    await holds(async () => {
      await expect(dialog).toBeVisible(NOW);
      await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(1, NOW);
    }, 300);

    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await expect(opener).toBeFocused();
  });

  test("12b. onConfirm вернул false: окно остаётся открытым, тост ровно один (повтор не сработал)", async ({ page }) => {
    await page.goto(UI_KIT);
    await button(page, overlays.confirmKeepOpen).click();
    const dialog = page.getByRole("dialog", { name: overlays.confirmKeepOpenTitle });
    await expect(dialog).toBeVisible();
    await button(dialog, overlays.confirmKeepOpenLabel).click();
    await dialog.locator('[aria-busy="true"]').dispatchEvent("click");
    await expect(page.getByText(overlays.confirmKeepOpenToast)).toHaveCount(1);
    // Действие завершилось (тост показан) и снова доступно; дальше окно открыто, а второго тоста от повтора нет.
    await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(0);
    await holds(async () => {
      await expect(dialog).toBeVisible(NOW);
      await expect(page.getByText(overlays.confirmKeepOpenToast)).toHaveCount(1, NOW);
    });
  });

  test("12c. onConfirm бросил исключение: окно открыто, ошибок страницы и оверлея ошибки Next нет", async ({ page }) => {
    // Ошибка, дошедшая до пользователя, видна тремя способами: `pageerror` (необработанное исключение или отклонённый
    // промис), `console.error` и оверлей Next. Оверлей живёт в shadow root элемента <nextjs-portal>; локаторы
    // Playwright проникают в открытые shadow root. Селекторы проверены на Next 16.4.3 (next dev): после
    // `Promise.reject(new Error(...))` на странице `[data-nextjs-dialog]` и `[data-issues]` появляются (0 → 1).
    // `[data-nextjs-toast]` есть всегда (плашка dev-индикатора), поэтому его не используем.
    // Известного безвредного шума типа error нет: на витрине в dev приходят только info/log/warning.
    // Предупреждение `kit.confirm-dialog: onConfirm failed` — `logger.warn`, это не error.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const nextOverlay = page.locator("[data-nextjs-dialog], [data-issues]");
    await page.goto(UI_KIT);
    await button(page, overlays.confirmThrow).click();
    const dialog = page.getByRole("dialog", { name: overlays.confirmThrowTitle });
    await expect(dialog).toBeVisible();
    await button(dialog, overlays.confirmThrowLabel).click();
    await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 5_000 });
    await holds(async () => {
      await expect(dialog).toBeVisible(NOW);
      await expect(nextOverlay).toHaveCount(0, NOW);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    }, 600);
  });
});

// ───────── 13. Переключатель темы ─────────

test.describe("ThemeSwitch", () => {
  test("13a. «Тёмная» ставит data-theme и переживает перезагрузку, «Авто» снимает", async ({ page }) => {
    await page.goto(UI_KIT);
    const html = page.locator("html");
    const t = shell.theme;
    await button(page, t.dark).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(button(page, t.dark)).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await button(page, t.system).click();
    await expect(html).not.toHaveAttribute("data-theme");
    await page.reload();
    await expect(html).not.toHaveAttribute("data-theme");
  });

  test.describe("без JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    // ДЕФЕКТ ПРОДУКТА (найден этим сценарием): без JavaScript форма уходит обычным POST, и Chromium присылает
    // `Origin: null`, потому что next.config.ts ставит заголовок `Referrer-Policy: no-referrer`. Проверка Origin в
    // Next (action-handler, защита от CSRF) отвечает: «`x-forwarded-host` ... does not match `origin` ... `null`»,
    // «Invalid Server Actions request» и статус 500 — тема не меняется. Ожидание честное, поэтому сценарий fixme.
    test.fixme("13b. отправка формы переключает тему на сервере", async ({ page }) => {
      await page.goto(UI_KIT);
      await button(page, shell.theme.dark).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    });
  });
});

// ───────── 14. Неизвестный адрес v1 ─────────

test("14. неизвестный адрес: 404 внутри оболочки v1", async ({ page }) => {
  const response = await page.goto("/no-such-page-xyz");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: ru.common.errors.notFound })).toBeVisible();
  // Оболочка v1 не ставит data-device; шапка и меню на месте.
  await expect(page.locator("html")).not.toHaveAttribute("data-device");
  await expect(page.getByRole("main")).toBeVisible();
  // Навигация v1 видна по своему имени (ru.common.shell.navLabel), а не по общему тегу <header>.
  await expect(page.getByRole("navigation", { name: ru.common.shell.navLabel }).first()).toBeVisible();
});

// ───────── 16. Поповер (компьютер) ─────────

test.describe("поповер", () => {
  test.skip(({ isMobile }) => isMobile, "только проект desktop");

  test("16. открывается кликом, Escape закрывает и возвращает фокус, страница за ним прокручивается", async ({ page }) => {
    await page.goto(UI_KIT);
    const trigger = button(page, showcase.explain.label);
    await trigger.click();
    const popover = page.getByRole("dialog", { name: showcase.explain.title });
    await expect(popover).toBeVisible();

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(5, 400);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(popover).toBeVisible();

    // Прокрутка могла увести кнопку из окна — фокус и Escape от этого не зависят.
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

// ───────── 18. Форма на useActionForm ─────────

test.describe("форма на useActionForm (витрина)", () => {
  const sample = showcase.formSample;

  test("18. ошибка у поля, введённое не сбрасывается, двойной клик даёт один вызов", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) calls.push(request.url());
    });
    await page.goto(UI_KIT);
    const form = page.locator("form").filter({ has: page.getByLabel(sample.label, { exact: true }) });
    const field = form.getByLabel(sample.label, { exact: true });
    await field.fill("12345");
    await button(form, sample.submit).dblclick();
    // Ответ сервера пришёл: ошибка стоит у поля и связана с ним.
    await expect(form.getByText(sample.fieldError)).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    // React 19 не сбросил неуправляемое поле (форма подключена через onSubmit, а не action={…}).
    await expect(field).toHaveValue("12345");
    expect(calls, "двойной клик отправил действие дважды").toHaveLength(1);
    // После ответа форму можно отправить снова.
    await expect(form.getByText(sample.received(undefined))).toBeVisible();
    await button(form, sample.submit).click();
    await expect.poll(() => calls.length).toBe(2);
    await expect(form.getByText(sample.fieldError)).toBeVisible();
    await expect(field).toHaveValue("12345");
    // Вторая кнопка отправки: действие получает её name=value; у первой имени не было.
    await button(form, sample.submitAgain).click();
    await expect(form.getByText(sample.received("again"))).toBeVisible();
    await expect(form.getByText(sample.received(undefined))).toHaveCount(0);
    expect(calls).toHaveLength(3);
  });
});

// ───────── 19. ActionDock над панелью вкладок ─────────

test.describe("ActionDock на телефоне", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");
  const DOCK_PAGE = "/v2/ui-kit/dock";
  const dockText = showcase.dockPage;

  /** Прокрутка: 0 — начало, 1 — самый низ. */
  async function scrollTo(page: Page, fraction: number) {
    await page.evaluate((f) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * f);
    }, fraction);
  }

  const dockOf = (page: Page) => page.locator("[data-action-dock]");
  const barOf = (page: Page) => page.locator("[data-tab-bar]");

  /** Зазор между нижним краем дока и верхним краем панели вкладок. */
  async function gapToBar(page: Page): Promise<number> {
    const [dock, bar] = await Promise.all([box(dockOf(page)), box(barOf(page))]);
    return bar.y - (dock.y + dock.height);
  }

  test("19а. док стоит над панелью с зазором 8 px в начале, середине и конце страницы", async ({ page }) => {
    await page.goto(DOCK_PAGE);
    await expect(dockOf(page)).toBeVisible();
    for (const fraction of [0, 0.5, 1]) {
      await scrollTo(page, fraction);
      await expect.poll(async () => Math.abs((await gapToBar(page)) - 8), { message: `прокрутка ${fraction}` }).toBeLessThanOrEqual(2);
    }
  });

  test("19б. в конце страницы док не перекрывает последний элемент и без двойного отступа", async ({ page }) => {
    await page.goto(DOCK_PAGE);
    await scrollTo(page, 1);
    await expect.poll(async () => Math.abs((await gapToBar(page)) - 8)).toBeLessThanOrEqual(2);
    const last = await box(page.locator("[data-last-content]"));
    const dock = await box(dockOf(page));
    const gap = dock.y - (last.y + last.height);
    expect(gap, "док перекрывает последний элемент").toBeGreaterThanOrEqual(0);
    // Зазор колонки — 12 px: больше значило бы двойной отступ (док ниже своего места или лишнее поле).
    expect(gap, "между содержимым и доком двойной отступ").toBeLessThanOrEqual(14);
    // Дальше вниз страница не прокручивается: док не оставил пустого места под собой.
    const spare = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - window.scrollY);
    expect(spare).toBeLessThanOrEqual(1);
  });

  test("19е. короткий экран: док у нижнего края над панелью вкладок, а не под содержимым", async ({ page }) => {
    await page.goto(`${DOCK_PAGE}?short=1`);
    await expect(dockOf(page)).toBeVisible();
    // Страница короче экрана: прокрутки нет.
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(scrollable).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.abs((await gapToBar(page)) - 8)).toBeLessThanOrEqual(2);
    const last = await box(page.locator("[data-last-content]"));
    const dock = await box(dockOf(page));
    expect(dock.y, "док вплотную под содержимым посреди экрана").toBeGreaterThan(last.y + last.height + 40);
  });

  test("19г. --tab-bar-height совпадает с настоящей высотой панели", async ({ page }) => {
    await page.goto(DOCK_PAGE);
    await expect(barOf(page)).toBeVisible();
    await expect
      .poll(async () => {
        const declared = await page.evaluate(() => parseFloat(document.querySelector<HTMLElement>("[data-has-tabs]")?.style.getPropertyValue("--tab-bar-height") ?? "NaN"));
        return Math.abs(declared - (await box(barOf(page))).height);
      })
      .toBeLessThanOrEqual(1);
  });

  test.describe("шрифт 200% при 360 px", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("19в. док поднимается вместе с выросшей панелью, горизонтальной прокрутки нет", async ({ page }) => {
      await page.goto(DOCK_PAGE);
      const normalBar = (await box(barOf(page))).height;
      await page.addStyleTag({ content: "html{font-size:200%}" });
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
      await expect.poll(async () => (await box(barOf(page))).height).toBeGreaterThan(normalBar);
      // Зазор задан в rem (0,5 rem), как и всё в kit: при шрифте 200% он 16 px.
      for (const fraction of [0, 1]) {
        await scrollTo(page, fraction);
        await expect.poll(async () => Math.abs((await gapToBar(page)) - 16), { message: `прокрутка ${fraction}` }).toBeLessThanOrEqual(2);
      }
      await expect
        .poll(async () => {
          const declared = await page.evaluate(() => parseFloat(document.querySelector<HTMLElement>("[data-has-tabs]")?.style.getPropertyValue("--tab-bar-height") ?? "NaN"));
          return Math.abs(declared - (await box(barOf(page))).height);
        })
        .toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(overflow.scroll, "страница шире окна").toBeLessThanOrEqual(overflow.client);
      await expect(button(dockOf(page), dockText.primary)).toBeVisible();
    });
  });

  test("19д. без панели вкладок (роль без вкладок) док прилипает к низу с отступом 10 px", async ({ page }) => {
    await page.goto(DOCK_PAGE);
    await expect(dockOf(page)).toBeVisible();
    // У оператора вкладок нет: оболочка без data-has-tabs и без панели. Вход оператора в e2e v2 недоступен, поэтому то
    // же состояние воспроизводится в DOM — проверяется CSS дока, а не выбор оболочки.
    await page.evaluate(() => {
      document.querySelector("[data-tab-bar]")?.closest("nav")?.remove();
      const shell = document.querySelector<HTMLElement>("[data-has-tabs]");
      shell?.removeAttribute("data-has-tabs");
      shell?.style.removeProperty("--tab-bar-height");
    });
    const height = viewportOf(page).height;
    for (const fraction of [0, 0.5, 1]) {
      await scrollTo(page, fraction);
      await expect
        .poll(async () => {
          const dock = await box(dockOf(page));
          return Math.abs(height - (dock.y + dock.height) - 10);
        }, { message: `прокрутка ${fraction}` })
        .toBeLessThanOrEqual(2);
    }
  });
});

// ───────── 20. Оболочка телефона: док и экраны без дока ─────────

test.describe("оболочка телефона: док не ломает раскладку", () => {
  test.skip(({ isMobile }) => !isMobile, "только проект mobile");

  test("20а. профиль мастера (длинный экран с доком): док прилипает над панелью, содержимое не перекрыто", async ({ page }) => {
    await page.goto("/v2/executors/5");
    const dock = page.locator("[data-action-dock]");
    const bar = page.locator("[data-tab-bar]");
    await expect(dock).toBeVisible();
    const gap = async () => (await box(bar)).y - ((await box(dock)).y + (await box(dock)).height);
    for (const fraction of [0, 0.5, 1]) {
      await page.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * f), fraction);
      await expect.poll(async () => Math.abs((await gap()) - 8), { message: `прокрутка ${fraction}` }).toBeLessThanOrEqual(2);
    }
    // В конце страницы предыдущий элемент колонки целиком выше дока.
    const overlap = await page.evaluate(() => {
      const d = document.querySelector("[data-action-dock]");
      const prev = d?.previousElementSibling;
      return prev && d ? prev.getBoundingClientRect().bottom - d.getBoundingClientRect().top : 0;
    });
    expect(overlap, "док перекрывает содержимое").toBeLessThanOrEqual(0);
  });

  for (const path of ["/v2", "/v2/catalog", "/v2/about", "/v2/deals/1"]) {
    test(`20б. ${path}: страница не шире окна, main не сжат, main — колонка только при доке, нет лишней прокрутки`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const m = await page.evaluate(() => {
        const main = document.querySelector("main");
        const bar = document.querySelector("[data-tab-bar]");
        const root = document.documentElement;
        return {
          scroll: root.scrollWidth,
          client: root.clientWidth,
          mainWidth: main?.getBoundingClientRect().width ?? 0,
          mainDisplay: main ? getComputedStyle(main).display : "",
          hasDock: document.querySelector("main [data-action-dock]") !== null,
          // Всё, что ниже панели вкладок: её отступ от низа (10 px) и ничего больше.
          below: root.scrollHeight - ((bar?.getBoundingClientRect().bottom ?? 0) + window.scrollY),
        };
      });
      expect(m.scroll, "страница шире окна").toBeLessThanOrEqual(m.client);
      // main — колонка до 560 px: на Pixel 7 (412 px) занимает всю ширину окна, а не сжимается по содержимому.
      expect(Math.abs(m.mainWidth - Math.min(m.client, 560))).toBeLessThanOrEqual(1);
      // Колонкой main становится только при доке внутри; без дока он обычный блок, как до дока.
      expect(m.mainDisplay).toBe(m.hasDock ? "flex" : "block");
      expect(m.below, "лишняя прокрутка под панелью").toBeLessThanOrEqual(12);
    });
  }

  test("20в. каталог: лента чипов прокручивается вбок, страница — нет", async ({ page }) => {
    await page.goto("/v2/catalog");
    const rail = page.locator("main nav ul").first();
    await expect(rail).toBeVisible();
    const sizes = await rail.evaluate((el) => ({ scroll: el.scrollWidth, client: el.getBoundingClientRect().width }));
    expect(sizes.scroll, "лента не прокручивается").toBeGreaterThan(sizes.client);
    const page_ = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(page_.s).toBeLessThanOrEqual(page_.c);
  });
});
