import type { Page } from "@playwright/test";
import { testIin } from "@/demo/kz-id";
import { ru } from "@/i18n/ru";

/**
 * Общее для сценариев и скрипта снимков нового интерфейса (/v2): новые номера и ИИН, открытие страницы после гидратации,
 * чтение кода входа с экрана. Модуль не использует expect: его импортирует и scripts/shots.ts (вне Playwright Test).
 * Подписи — только из ru.
 */

const login = ru.app.login;

export type PhoneNumber = {
  /** Как вводит человек: «+7 7XX XXX XX XX». */
  typed: string;
  /** Десять цифр национальной части: «7XXXXXXXXX». */
  digits: string;
};

/**
 * Новый казахстанский мобильный номер. identity стенда отвечает «слишком часто» на повтор кода раньше минуты и ограничивает
 * новые номера суточным потолком на префикс (первые 6 цифр) — случайные цифры разносят номера по префиксам.
 */
export function freshPhone(): PhoneNumber {
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  const digits = `7${rest}`;
  return {
    typed: `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`,
    digits,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Новый тестовый ИИН с верной контрольной цифрой: дата рождения и порядковая часть случайные (не все основы допустимы — повтор). */
export function freshIin(): string {
  for (;;) {
    const birth = `${pad(70 + Math.floor(Math.random() * 30))}${pad(1 + Math.floor(Math.random() * 12))}${pad(1 + Math.floor(Math.random() * 28))}`;
    try {
      return testIin(birth, 3, 1 + Math.floor(Math.random() * 9999));
    } catch {
      // Для этой основы нет допустимой контрольной цифры.
    }
  }
}

/** Открыть адрес и дождаться загрузки скриптов: нажатие до гидратации отправило бы форму браузером, а не действием. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Код входа из плашки на экране шага кода («Сообщения пока не отправляются. Ваш код: NNNNNN»). */
export async function readShownCode(page: Page): Promise<string> {
  const shown = page.getByText(new RegExp(login.code.shownCode("\\d{6}")));
  await shown.waitFor({ state: "visible" });
  const code = (await shown.textContent())?.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Код не найден на экране");
  return code;
}

export type LoginRole = "client" | "executor";

const ONBOARDING_STEPS = ["/v2/consent", "/v2/welcome", "/v2/email"] as const;
const WIZARD_STEP_MS = 30_000;

const primary = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/**
 * Вход по номеру через `/v2/login`: роль → номер → код с экрана → «Войти». Роль выбирается только на первом шаге
 * (по умолчанию «Я покупатель»; у уже заведённого человека выбор ничего не меняет). Возвращается, когда адрес ушёл с экрана
 * входа: новый номер — на первый шаг онбординга, известный — туда, где он остановился. `phone` — в любом виде, который
 * принимает поле («+7 777 123 45 67» или «7771234567»).
 */
export async function loginV2(page: Page, phone: string, options: { role?: LoginRole } = {}): Promise<void> {
  const t = login;
  await open(page, "/v2/login");
  if (options.role === "executor") await page.getByText(t.role.executor, { exact: true }).click();
  await primary(page, t.role.submit).click();
  await page.getByLabel(t.phone.label).waitFor({ state: "visible" });
  await page.getByLabel(t.phone.label).fill(phone);
  await primary(page, t.phone.submit).click();
  const code = await readShownCode(page);
  await page.getByLabel(t.code.label).fill(code);
  await primary(page, t.code.submit).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/v2/login"), { timeout: WIZARD_STEP_MS });
  await page.waitForLoadState("networkidle");
}

/**
 * Пройти шаги онбординга, которые есть на пути: согласие → знакомство (ФИО и новый ИИН) → почта. Начинать можно с любого
 * шага (после `loginV2`); шаг, которого нет в адресе, пропускается. Заканчивается, когда адрес вышел за пределы шагов.
 * Если шаг почты ещё не построен или идёт заглушкой раздела — функция заканчивает на нём, не падая.
 */
export async function passOnboarding(page: Page, options: { fullName?: string; iin?: string } = {}): Promise<void> {
  const consent = ru.app.onboarding.consent;
  const welcome = ru.app.onboarding.welcome;
  const pathOf = () => new URL(page.url()).pathname.replace(/\/+$/, "");

  for (let guard = 0; guard < ONBOARDING_STEPS.length + 1; guard += 1) {
    const here = pathOf();
    if (here === "/v2/consent") {
      await page.getByText(consent.agree, { exact: true }).click();
      await primary(page, consent.submit).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/v2/consent"), { timeout: WIZARD_STEP_MS });
    } else if (here === "/v2/welcome") {
      await page.getByLabel(welcome.fullName).fill(options.fullName ?? "Сапаров Ерлан");
      await page.getByLabel(welcome.iin).fill(options.iin ?? freshIin());
      await primary(page, welcome.submit).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/v2/welcome"), { timeout: WIZARD_STEP_MS });
    } else if (here === "/v2/email") {
      // Шаг почты (D2): заполнить и подтвердить почту здесь. Пока не построен — остановиться на нём.
      return;
    } else {
      return;
    }
    await page.waitForLoadState("networkidle");
  }
}
