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
// Уход с поля
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Поле теряет фокус, потому что нажали кнопку отправки его же формы (`relatedTarget` блюра — `<button>`/`<input>` с
 * `type="submit"`, у которой `form` — форма поля; кнопка в доке связана с формой атрибутом `form`). Проверку при уходе с
 * поля тогда не показывают: ошибка встала бы под полем между нажатием и отпусканием мыши, кнопка в потоке страницы
 * (компьютер) съехала бы из-под курсора, и щелчок потерялся бы — форма не отправилась. Номер проверит отправка.
 */
export function blursToSubmit(field: { form: unknown }, next: unknown): boolean {
  if (field.form == null || typeof next !== "object" || next === null || !("tagName" in next)) return false;
  const control = next as { tagName: unknown; type?: unknown; form?: unknown };
  const tag = String(control.tagName).toUpperCase();
  return (tag === "BUTTON" || tag === "INPUT") && control.type === "submit" && control.form === field.form;
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

/** Ссылка на Instagram: путь после `instagram.com/` (с `https://`, `www.`, `?igsh=…`). */
const LINK = /(?:^|\/\/|\.|\s)(?:www\.)?instagram\.com\/([^\s?#]*)/i;
/** Пути публикаций, а не профиля: пост, ролик, видео, подборка. */
const POST_PATH = /^(?:p|reel|reels|tv|explore)\//i;
const NAME = /^[A-Za-z0-9._]+/;

export type InstagramEdit = {
  /** Имя без «@» для поля. */
  value: string;
  /** Курсор в поле после чистки. */
  caret: number;
  /** Вставлена ссылка на публикацию (пост, ролик), а не на профиль: имени в ней нет. */
  post: boolean;
};

/**
 * Что человек ввёл в поле Instagram → имя без «@» (знак «@» стоит в поле отдельно) и курсор.
 * - Ссылка на профиль из приложения («https://www.instagram.com/dala.mebel?igsh=…», «…/stories/dala/…») → «dala.mebel»,
 *   курсор в конце.
 * - Ссылка на публикацию («instagram.com/p/…», «/reel/…») — не имя: поле пустое, `post` (экран показывает ошибку).
 * - «@dala» → «dala»; пробелы (в имени их не бывает, iOS ставит их после подсказки слова) убираются; курсор сдвигается
 *   ровно на убранные перед ним символы, а не прыгает в конец.
 * - Пока ссылка набирается и имени в ней ещё нет, строка не меняется. Правила имени проверяет схема на сервере.
 */
export function instagramEdit(raw: string, caret: number = raw.length): InstagramEdit {
  const link = LINK.exec(raw);
  if (link) {
    const path = link[1];
    if (POST_PATH.test(path)) return { value: "", caret: 0, post: true };
    const name = NAME.exec(path.replace(/^stories\//i, ""))?.[0];
    if (name) return { value: name, caret: name.length, post: false };
    return { value: raw, caret, post: false };
  }
  const clean = (text: string) => text.replace(/\s/g, "").replace(/^@+/, "");
  const value = clean(raw);
  return { value, caret: clean(raw.slice(0, caret)).length, post: false };
}

/** Имя из любой строки (значение по умолчанию): то же, что правка с курсором в конце. */
export function instagramName(raw: string): string {
  return instagramEdit(raw).value;
}
