import { maskContacts } from "./mask";

/**
 * Место работы в портфолио — город, район или ЖК (встреча 31.10, п. 3). Точный адрес заказчика не
 * показываем: слова улицы, дома, квартиры и «дом/квартира» через дробь (10/2) не принимаются, контакты — тоже.
 * Эвристика, а не гарантия: подсказка в форме просит то же самое словами.
 */
const ADDRESS_WORD =
  /(?<!\p{L})(ул|улица|пр-т|просп|проспект|пер|переулок|шоссе|бульвар|б-р|наб|набережная|д|дом|кв|квартира|корп|корпус|подъезд|этаж|street|st|avenue|ave|apt)(?!\p{L})/iu;
const HOUSE_SLASH = /\d+\s*[/\\]\s*\d+/;

export function isPlaceAllowed(place: string): boolean {
  return !ADDRESS_WORD.test(place) && !HOUSE_SLASH.test(place) && !maskContacts(place).masked;
}
