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
  const shown = page.getByText(new RegExp(login.code.shownCode("\d{6}")));
  await shown.waitFor({ state: "visible" });
  const code = (await shown.textContent())?.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Код не найден на экране");
  return code;
}
