/**
 * Чистые правила полей kit без масок: код из сообщения (автоотправка), почта (подсказка опечатки в домене), Instagram
 * (ссылка или имя). Без React и браузера.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Код из сообщения
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Отправлять ли код сам: набраны все `length` цифр и этот код ещё не отправлялся. `sent` — код последней автоотправки
 * (`null` — не было или код с тех пор становился неполным: стёртая и снова набранная цифра — новая попытка). Возвращает
 * решение и новое значение `sent`. Код с ошибкой не уходит повторно, пока человек его не изменил.
 */
export function codeAutoSubmit(raw: string, length: number, sent: string | null): { submit: boolean; sent: string | null } {
  const code = raw.replace(/[^0-9]/g, "");
  if (code.length !== length) return { submit: false, sent: null };
  if (code === sent) return { submit: false, sent };
  return { submit: true, sent: code };
}

// ---------------------------------------------------------------------------------------------------------------------
// Почта
// ---------------------------------------------------------------------------------------------------------------------

/** Почтовые домены, к которым подсказывается исправление (самые частые в РК). */
export const EMAIL_DOMAINS = [
  "gmail.com",
  "mail.ru",
  "yandex.ru",
  "yandex.kz",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "icloud.com",
  "outlook.com",
  "hotmail.com",
] as const;

/** Настоящие домены, похожие на частые: к ним исправление не подсказывается («ya.ru» — не опечатка «bk.ru»). */
const KNOWN_DOMAINS = new Set<string>([...EMAIL_DOMAINS, "ya.ru", "mail.kz", "yandex.com", "me.com", "mac.com", "live.com", "yahoo.com", "rambler.ru", "internet.ru"]);

/** Расстояние Левенштейна (вставка, удаление, замена — по 1). */
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Исправленный адрес, если домен похож на частый, но не совпадает с ним: «aigerim@gmial.com» → «aigerim@gmail.com»,
 * «a@mail.ri» → «a@mail.ru», «a@gmail» → «a@gmail.com». Иначе `null`. Порог — 1 правка для коротких доменов (до 6 знаков:
 * у «bk.ru» и «ya.ru» две правки разницы) и 2 для длинных; известные настоящие домены не исправляются.
 */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (KNOWN_DOMAINS.has(domain)) return null;
  if (!domain.includes(".")) {
    const whole = EMAIL_DOMAINS.find((d) => d.split(".")[0] === domain);
    return whole ? `${local}@${whole}` : null;
  }
  let best: { domain: string; distance: number } | null = null;
  for (const candidate of EMAIL_DOMAINS) {
    const distance = editDistance(domain, candidate);
    const limit = candidate.length <= 6 ? 1 : 2;
    if (distance <= limit && (best === null || distance < best.distance)) best = { domain: candidate, distance };
  }
  return best ? `${local}@${best.domain}` : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------------------------------------------------

/** Ссылка на профиль: `instagram.com/<имя>` (с `https://`, `www.`, `?igsh=…`, `/` в конце). */
const PROFILE_LINK = /(?:^|\/\/|\.|\s)(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i;

/**
 * Что человек ввёл в поле Instagram → имя без «@» (знак «@» стоит в поле отдельно). Ссылка из приложения
 * («https://www.instagram.com/dala.mebel?igsh=…») → «dala.mebel»; «@dala» → «dala»; пробелы (в имени их не бывает, iOS
 * ставит их после подсказки слова) убираются. Остальное — как есть: правила имени
 * проверяет схема на сервере. Пока ссылка набирается и имени в ней ещё нет, строка не меняется.
 */
export function instagramName(raw: string): string {
  const link = PROFILE_LINK.exec(raw);
  if (link) return link[1];
  return raw.replace(/\s/g, "").replace(/^@+/, "");
}
