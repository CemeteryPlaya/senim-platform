/**
 * Адреса внешних ссылок «одним касанием»: звонок, WhatsApp, карты. Форматы — только по документации:
 * - `tel:` — RFC 3966 (https://www.rfc-editor.org/rfc/rfc3966): `tel:+77001234567`;
 * - WhatsApp click-to-chat — https://faq.whatsapp.com/5913398998672934: `https://wa.me/<номер в международном формате>`, без
 *   «+», нулей, скобок и дефисов;
 * - Google Maps URLs, действие Search — https://developers.google.com/maps/documentation/urls/get-started:
 *   `https://www.google.com/maps/search/?api=1&query=<широта>%2C<долгота>` (или адрес текстом в `query`);
 * - Яндекс Карты, веб-версия — https://yandex.com/dev/yandex-apps-launch-maps/doc/ru/concepts/yandexmaps-web:
 *   `https://yandex.ru/maps/?pt=<долгота>,<широта>&z=<1–19>&l=map` (порядок «долгота, широта»).
 * 2ГИС не подключён: официального описания веб-ссылки на точку нет (документирована только схема приложения `dgis://`).
 * Чистые функции, без браузера: проверяются юнит-тестами.
 */

/** Только цифры номера: «+7 (700) 123-45-67» → «77001234567». */
const digitsOf = (phone: string): string => phone.replace(/\D/g, "");

/** `tel:` по номеру в формате E.164 (как отдаёт модуль). Лишнее в номере отбрасывается, плюс остаётся. */
export function telHref(phone: string): string {
  return `tel:+${digitsOf(phone)}`;
}

/** WhatsApp: номер цифрами без «+». `null` — в номере нет цифр. */
export function whatsappHref(phone: string): string | null {
  const digits = digitsOf(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

export type MapPoint = { lat: number; lng: number };

const validPoint = (p: MapPoint): boolean => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Google Карты: по точке; без точки — поиск по адресу; ничего нет — `null`. */
export function googleMapsHref(point: MapPoint | null, address?: string | null): string | null {
  if (point && validPoint(point)) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`;
  const text = address?.trim();
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

/** Яндекс Карты: только по точке (поиск по адресу в документации не описан). */
export function yandexMapsHref(point: MapPoint | null): string | null {
  return point && validPoint(point) ? `https://yandex.ru/maps/?pt=${point.lng},${point.lat}&z=17&l=map` : null;
}
