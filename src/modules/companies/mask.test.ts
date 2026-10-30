import { describe, expect, it } from "vitest";
import { MASK, maskContacts, maskIdentity } from "./mask";

const masked = (text: string) => maskContacts(text).text;

describe("maskContacts: телефоны", () => {
  it.each([
    ["+7 700 123 45 67", "Звоните: +7 700 123 45 67"],
    ["+77001234567", "мой номер +77001234567"],
    ["87001234567", "87001234567"],
    ["8 (700) 123-45-67", "Номер 8 (700) 123-45-67, звоните"],
    ["+7 (701) 123-45-67", "+7 (701) 123-45-67"],
    ["8-700-123-45-67", "тел. 8-700-123-45-67"],
    ["8 700 123 4567", "8 700 123 4567"],
    ["8700 123 45 67", "8700 123 45 67"],
    ["7 700 123 45 67", "7 700 123 45 67"],
    ["700 123 45 67", "мобильный 700 123 45 67"],
    ["8.700.123.45.67", "8.700.123.45.67"],
    ["8 7 0 0 1 2 3 4 5 6 7", "8 7 0 0 1 2 3 4 5 6 7"],
    ["+7 700 000 01 01", "демо +7 700 000 01 01"],
    ["8 700 123-45-67", "8 700 123-45-67"],
    ["+998 90 123 45 67", "узбекский +998 90 123 45 67"],
    ["8 (7172) 12-34-56", "городской 8 (7172) 12-34-56"],
  ])("скрывает %s", (phone, text) => {
    const result = maskContacts(text);
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain(phone);
    expect(result.text).toContain(MASK);
    expect(result.text.replace(MASK, "")).not.toMatch(/\d{2}/);
  });

  it("оставляет текст вокруг номера", () => {
    expect(masked("Звоните: +7 700 123 45 67, жду")).toBe(`Звоните: ${MASK}, жду`);
  });

  it("скрывает два номера подряд", () => {
    expect(masked("87001234567 и 87011234567")).toBe(`${MASK} и ${MASK}`);
  });

  it("находит номер после года и цены", () => {
    expect(masked("в 2026 8 700 123 45 67")).toBe(`в 2026 ${MASK}`);
    expect(masked("цена 350 000 87001234567")).toBe(`цена 350 000 ${MASK}`);
  });

  it("скрывает ИИН/БИН из 12 цифр подряд", () => {
    expect(masked("мой БИН 210140012345")).toBe(`мой БИН ${MASK}`);
  });

  it.each([
    "восемь семьсот один двести тридцать четыре пятьдесят шесть семьдесят восемь",
    "Восемь семь ноль ноль один два три четыре пять шесть семь",
    "8 семьсот 123 45 67",
    "плюс семь семьсот ноль ноль ноль ноль один ноль один",
    "восемь-семьсот-сто двадцать три-сорок пять-шестьдесят семь",
  ])("скрывает номер словами: %s", (text) => {
    const result = maskContacts(`Мой номер: ${text}. Жду звонка`);
    expect(result.masked).toBe(true);
    expect(result.text).toBe(`Мой номер: ${MASK}. Жду звонка`);
  });
});

describe("maskContacts: e-mail, ссылки, ники", () => {
  it.each([
    ["ivan.petrov@gmail.com", "Пишите на ivan.petrov@gmail.com"],
    ["mebel_astana+zakaz@mail.kz", "mebel_astana+zakaz@mail.kz"],
    ["ivan собака gmail точка com", "почта ivan собака gmail точка com"],
    ["ivan (at) mail (dot) ru", "ivan (at) mail (dot) ru"],
    ["ivan at gmail dot com", "ivan at gmail dot com"],
    ["https://wa.me/77001234567", "ссылка https://wa.me/77001234567"],
    ["http://example.com/page?a=1", "http://example.com/page?a=1"],
    ["www.mebel-astana.kz", "сайт www.mebel-astana.kz"],
    ["t.me/mebel_astana", "t.me/mebel_astana"],
    ["instagram.com/agash.sheber", "instagram.com/agash.sheber"],
    ["mebel.kz", "наш сайт mebel.kz"],
    ["мебель.рф", "мебель.рф"],
    ["@mebel_astana", "мой ник @mebel_astana"],
  ])("скрывает %s", (contact, text) => {
    const result = maskContacts(text);
    expect(result.masked).toBe(true);
    expect(result.text).not.toContain(contact);
    expect(result.text).toContain(MASK);
  });

  it("не оставляет хвост ссылки и сохраняет точку в конце предложения", () => {
    expect(masked("Смотрите https://site.kz/portfolio.")).toBe(`Смотрите ${MASK}.`);
  });
});

describe("maskContacts: мессенджеры", () => {
  it.each([
    "WhatsApp",
    "whatsapp",
    "вотсап",
    "ватсап",
    "Ватсапе",
    "вацап",
    "ватс ап",
    "Telegram",
    "телеграм",
    "телеграме",
    "телеге",
    "Instagram",
    "инстаграм",
    "инсте",
    "Viber",
    "вайбер",
    "вайбере",
    "Skype",
    "скайп",
    "вконтакте",
    "VK",
    "фейсбук",
    "tiktok",
    "тикток",
  ])("скрывает упоминание «%s»", (word) => {
    const result = maskContacts(`Напишите мне в ${word}, там удобнее`);
    expect(result.masked).toBe(true);
    expect(result.text).toBe(`Напишите мне в ${MASK}, там удобнее`);
  });

  it("скрывает ник без @ сразу после мессенджера", () => {
    expect(masked("мой инст mebel_astana, заходите")).toBe(`мой ${MASK}, заходите`);
    expect(masked("Telegram: mebel.astana")).toBe(MASK);
    expect(masked("В телеграме удобнее")).toBe(`В ${MASK} удобнее`);
  });

  it("склеивает соседние скрытые фрагменты в один", () => {
    expect(masked("WhatsApp: +7 700 123 45 67")).toBe(MASK);
    expect(masked("Telegram @mebel_astana")).toBe(MASK);
  });
});

describe("maskContacts: ложные срабатывания", () => {
  it.each([
    "Предварительная цена 1 350 000 ₸",
    "Цена 1350000 тг, срок 18–25 дней",
    "Бюджет 700 000-1 000 000",
    "Бюджет 70000-800000",
    "Вилка 900000 - 1000000",
    "Бюджет 700 000 – 1 000 000 тенге",
    "Бюджет от 7 000 000 – 9 000 000",
    "Стоимость 12 500 000 000 ₸",
    "С профилем Gola — это плюс 40 000 ₸. Образцы покажу на замере.",
    "Кухня 3200 мм, высота 2400 мм, глубина 600",
    "Размер 2400×600×720",
    "Размеры 2400 х 600 х 720 мм",
    "Ширина 2,4 м, высота 2.7 м",
    "Столешница компакт-плита 12 мм",
    "Замер 12.10.2026 с 10:00 до 13:00",
    "С 7.08.2026 - 9.08.2026 меня не будет",
    "Срок 2026-10-12 — 2026-11-01",
    "Приеду на замер послезавтра в 11:00, возьму образцы реек.",
    "Сможете приехать на замер в субботу с 10 до 13?",
    "Аванс перевела на Kaspi, отметила в сделке.",
    "Договор №14, заявка №19, сделка №1234567890",
    "Гарантия 24 месяца, 5 лет опыта, 600+ проектов",
    "Сделаю за двадцать пять дней, два-три замера",
    "Ящики 400 500 600 мм",
    "Фурнитура Blum, Hettich; т.е. без ручек и т.д.",
    "Сигнал о готовности придёт в уведомлениях",
    "Получите 2 шт. по 15 000 ₸ и 3 шт. по 12 000 ₸",
    "Итого: 90 000 120 000 150 000",
    "Давайте здесь, в чате платформы.",
    "e-mail не нужен, всё в чате",
  ])("не трогает: %s", (text) => {
    expect(maskContacts(text)).toEqual({ text, masked: false });
  });
});

describe("maskContacts: свойства", () => {
  it("идемпотентен: повторная маска ничего не меняет", () => {
    const once = masked("Звоните +7 700 123 45 67 или пишите ivan@mail.kz, WhatsApp");
    expect(maskContacts(once)).toEqual({ text: once, masked: false });
  });

  it("пустой текст", () => {
    expect(maskContacts("")).toEqual({ text: "", masked: false });
  });
});

describe("maskIdentity", () => {
  it("скрывает наименование исполнителя без формы и кавычек", () => {
    expect(maskIdentity("Мы — ТОО «Ағаш Шебер», работаем с 2015", "ТОО «Ағаш Шебер»")).toBe(`Мы — ТОО «${MASK}», работаем с 2015`);
    expect(maskIdentity("Мастерская ағаш шебер в Астане", "ТОО «Ағаш Шебер»")).toBe(`Мастерская ${MASK} в Астане`);
  });

  it("скрывает ФИО самозанятого", () => {
    expect(maskIdentity("Меня зовут Ерлан Жумабаев", "Ерлан Жумабаев")).toBe(`Меня зовут ${MASK}`);
  });

  it("не трогает текст без наименования и не ломается на коротком имени", () => {
    expect(maskIdentity("Делаю кухни", "ТОО «Ағаш Шебер»")).toBe("Делаю кухни");
    expect(maskIdentity("ИП АБ делает кухни", "ИП АБ")).toBe("ИП АБ делает кухни");
  });
});
