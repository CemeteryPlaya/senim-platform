import { describe, expect, it } from "vitest";
import { kzCheckDigit } from "@/platform/kz-id";
import { codeAutoSubmit, editDistance, instagramName, suggestEmail } from "./field-logic";
import { checkIban, checkIdentity } from "./id-check";
import { applyEdit, fromRaw, IBAN_MASK, IIN_MASK, PHONE_MASK, phoneValue, pasteInto, type Edited, type Mask } from "./mask-logic";
import { MONEY_MASK, parseMoneyText } from "./money-logic";

const NBSP = " ";

/**
 * Набор по символу, как в поле: каждый символ вставляется на место курсора (курсор — там, куда его поставила маска после
 * прошлой правки). Возвращает итог последней правки.
 */
function typeInto(mask: Mask, text: string, start: Edited = { shown: "", value: "", caret: 0 }): Edited {
  let state = start;
  for (const ch of text) {
    const raw = state.shown.slice(0, state.caret) + ch + state.shown.slice(state.caret);
    state = applyEdit(mask, { prev: state.shown, raw, caret: state.caret + 1, inputType: "insertText", data: ch });
  }
  return state;
}

/** Backspace в позиции курсора `caret` поля `shown`. */
function backspace(mask: Mask, shown: string, caret: number): Edited {
  const raw = shown.slice(0, caret - 1) + shown.slice(caret);
  return applyEdit(mask, { prev: shown, raw, caret: caret - 1, inputType: "deleteContentBackward" });
}

/** Значение целиком (вставка в пустое поле, автозаполнение — без inputType). */
const filled = (mask: Mask, raw: string, inputType?: string): Edited => applyEdit(mask, { prev: "", raw, caret: raw.length, inputType });

describe("телефон: набор, вставка, автозаполнение", () => {
  it.each([
    ["набор 10 цифр", "7001234567", "700 123 45 67"],
    ["набор с ведущей 8", "87001234567", "700 123 45 67"],
    ["неполный номер", "70012", "700 12"],
    ["буквы и знаки не вводятся", "7a0-0(1)", "700 1"],
  ])("%s", (_, typed, shown) => {
    const out = typeInto(PHONE_MASK, typed);
    expect(out.shown).toBe(shown);
    expect(out.caret).toBe(shown.length);
  });

  it.each([
    ["+7 700 123 45 67", "insertFromPaste"],
    ["8 (700) 123-45-67", "insertFromPaste"],
    ["+7(700)1234567", "insertFromPaste"],
    ["87001234567", "insertFromPaste"],
    ["7001234567", "insertFromPaste"],
    ["+77001234567", undefined],
    ["8 700 123 45 67", "insertReplacementText"],
  ])("вставка и автозаполнение «%s» → 10 цифр", (raw, inputType) => {
    const out = filled(PHONE_MASK, raw, inputType);
    expect(out.value).toBe("7001234567");
    expect(out.shown).toBe("700 123 45 67");
    expect(phoneValue(out.value)).toBe("+77001234567");
  });

  it("номер целиком поверх прежнего (подсказка клавиатуры, заполнение одной правкой) — тоже 10 цифр", () => {
    const prev = "777 123 45 67";
    const out = applyEdit(PHONE_MASK, { prev, raw: "+77001234567", caret: 12, inputType: "insertText", data: "+77001234567" });
    expect(out.value).toBe("7001234567");
  });

  it("одиннадцатая цифра при наборе отклоняется: поле не меняется", () => {
    const full = typeInto(PHONE_MASK, "7771234567");
    const out = typeInto(PHONE_MASK, "8", full);
    expect(out.shown).toBe("777 123 45 67");
    expect(out.value).toBe("7771234567");
  });

  it("правка в середине: курсор остаётся после вставленной цифры", () => {
    // «700 12|3 45» → стереть «2» и набрать «9» на том же месте.
    const start = typeInto(PHONE_MASK, "70012345");
    expect(start.shown).toBe("700 123 45");
    const erased = backspace(PHONE_MASK, start.shown, 6);
    expect(erased.shown).toBe("700 134 5");
    expect(erased.caret).toBe(5);
    const typed = typeInto(PHONE_MASK, "9", erased);
    expect(typed.shown).toBe("700 193 45");
    expect(typed.caret).toBe(6);
  });

  it("Backspace сразу после пробела стирает цифру перед ним, а не пробел", () => {
    const out = backspace(PHONE_MASK, "700 123", 4);
    expect(out.shown).toBe("701 23");
    expect(out.value).toBe("70123");
    expect(out.caret).toBe(2);
  });

  it("Delete перед пробелом стирает цифру после него", () => {
    const shown = "700 123";
    const raw = shown.slice(0, 3) + shown.slice(4);
    const out = applyEdit(PHONE_MASK, { prev: shown, raw, caret: 3, inputType: "deleteContentForward" });
    expect(out.value).toBe("70023");
  });

  it("стереть всё — пустое значение и пустая строка для формы", () => {
    const out = applyEdit(PHONE_MASK, { prev: "700", raw: "", caret: 0, inputType: "deleteContentBackward" });
    expect(out).toEqual({ shown: "", value: "", caret: 0 });
    expect(phoneValue(out.value)).toBe("");
  });

  it("начальное значение в любом виде (номер из ответа «+7 700 000 01 01»)", () => {
    expect(fromRaw(PHONE_MASK, "+7 700 000 01 01")).toEqual({ shown: "700 000 01 01", value: "7000000101" });
    expect(fromRaw(PHONE_MASK, "")).toEqual({ shown: "", value: "" });
  });
});

describe("деньги: разбор вставки", () => {
  it.each([
    ["1 200 000", "1200000"],
    [`1${NBSP}200${NBSP}000 ₸`, "1200000"],
    ["1200000₸", "1200000"],
    ["1200000 тг", "1200000"],
    ["200 000 тенге", "200000"],
    ["1,2 млн", "1200000"],
    ["1.2 млн", "1200000"],
    ["1,25 млн", "1250000"],
    ["1.2M", "1200000"],
    ["1,5 тыс", "1500"],
    ["500 тыс.", "500000"],
    ["2 млрд", "2000000000"],
    ["1.200.000", "1200000"],
    ["1,200,000", "1200000"],
    ["1 200 000,50", "1200000"],
    ["120000.5", "120000"],
    ["0,5 млн", "500000"],
  ])("«%s» → %s", (text, digits) => {
    expect(parseMoneyText(text)).toBe(digits);
  });

  it.each(["", "абв", "1,2 кг", "1.2.3", "цена 100"])("«%s» — не сумма (null)", (text) => {
    expect(parseMoneyText(text)).toBeNull();
  });
});

describe("деньги: поле", () => {
  it("разряды через неразрывный пробел при наборе; буквы, точка и запятая не вводятся", () => {
    const out = typeInto(MONEY_MASK, "12,00a000");
    expect(out.value).toBe("1200000");
    expect(out.shown).toBe(`1${NBSP}200${NBSP}000`);
  });

  it("ведущие нули срезаются, одиночный ноль остаётся", () => {
    expect(typeInto(MONEY_MASK, "007").value).toBe("7");
    expect(typeInto(MONEY_MASK, "0").value).toBe("0");
  });

  it("вставка «1,2 млн» в пустое поле и на место выделения", () => {
    expect(pasteInto(MONEY_MASK, "", 0, 0, "1,2 млн")).toEqual({ shown: `1${NBSP}200${NBSP}000`, value: "1200000", caret: 9 });
    // Всё выделено — вставка заменяет сумму.
    expect(pasteInto(MONEY_MASK, `50${NBSP}000`, 0, 6, "1.2 млн")?.value).toBe("1200000");
    // Не сумма — вставку делает браузер (дальше обычный разбор цифр).
    expect(pasteInto(MONEY_MASK, "", 0, 0, "абв")).toBeNull();
  });

  it("предел — 10 цифр: одиннадцатая не вводится", () => {
    expect(typeInto(MONEY_MASK, "12345678901").value).toBe("1234567890");
  });

  it("правка в середине не уводит курсор в конец", () => {
    // «1 2|00 000» → вставить «5» после «2»: 12 500 000, курсор после «5».
    const start = typeInto(MONEY_MASK, "1200000");
    const raw = start.shown.slice(0, 3) + "5" + start.shown.slice(3);
    const out = applyEdit(MONEY_MASK, { prev: start.shown, raw, caret: 4, inputType: "insertText" });
    expect(out.shown).toBe(`12${NBSP}500${NBSP}000`);
    expect(out.shown.slice(0, out.caret)).toBe(`12${NBSP}5`);
  });
});

/** Верный ИИН/БИН из основы: контрольная цифра — по алгоритму РК. */
function withCheck(first11: string): string {
  const check = kzCheckDigit(first11);
  if (check === null) throw new Error("основа без контрольной цифры");
  return first11 + check;
}

describe("ИИН и БИН", () => {
  const iin = withCheck("87030430061");
  const bin = withCheck("05044000123");

  it("группы 6-3-3 при наборе и вставке, только цифры, не больше 12", () => {
    expect(typeInto(IIN_MASK, "870304").shown).toBe("870304");
    expect(typeInto(IIN_MASK, "8703043").shown).toBe("870304 3");
    expect(filled(IIN_MASK, `ИИН: ${iin.slice(0, 6)} ${iin.slice(6, 9)} ${iin.slice(9)}`, "insertFromPaste").value).toBe(iin);
    expect(typeInto(IIN_MASK, `${iin}5`).value).toBe(iin);
    expect(typeInto(IIN_MASK, iin).shown).toBe(`${iin.slice(0, 6)} ${iin.slice(6, 9)} ${iin.slice(9)}`);
  });

  it("контрольная цифра — до отправки: сразу после 12-й цифры", () => {
    const wrong = iin.slice(0, 11) + String((Number(iin[11]) + 1) % 10);
    expect(checkIdentity("iin", iin, false)).toBe("ok");
    expect(checkIdentity("iin", wrong, false)).toBe("invalid");
    expect(checkIdentity("bin", bin, false)).toBe("ok");
    // ИИН — не БИН: другой тип в 5-й цифре.
    expect(checkIdentity("bin", iin, false)).toBe("invalid");
  });

  it("неполный номер: пока набирается — без ошибки, при уходе с поля — «12 цифр»; пустое поле — не ошибка", () => {
    expect(checkIdentity("iin", "8703", false)).toBe("typing");
    expect(checkIdentity("iin", "8703", true)).toBe("short");
    expect(checkIdentity("iin", "", true)).toBe("empty");
  });
});

describe("IBAN", () => {
  it.each([
    ["kz86125kzt5004100100", "insertFromPaste"],
    ["KZ86 125K ZT50 0410 0100", "insertFromPaste"],
    [" kz86 125k zt50 0410 0100 ", undefined],
  ])("«%s» → заглавные, группы по 4", (raw, inputType) => {
    const out = filled(IBAN_MASK, raw, inputType);
    expect(out.value).toBe("KZ86125KZT5004100100");
    expect(out.shown).toBe("KZ86 125K ZT50 0410 0100");
  });

  it("набор строчными — заглавные; предел 20 знаков", () => {
    expect(typeInto(IBAN_MASK, "kz86125k").shown).toBe("KZ86 125K");
    expect(typeInto(IBAN_MASK, "KZ86125KZT50041001009").value).toHaveLength(20);
  });

  it("проверка той же parseKzIban: верный, ошибка в цифрах, не тот вид, неполный", () => {
    expect(checkIban("KZ86125KZT5004100100", false)).toBe("ok");
    expect(checkIban("KZ86125KZT5004100101", false)).toBe("invalid");
    expect(checkIban("RU86125KZT5004100100", false)).toBe("short");
    expect(checkIban("KZ86125", false)).toBe("typing");
    expect(checkIban("KZ86125", true)).toBe("short");
    expect(checkIban("", true)).toBe("empty");
  });
});

describe("код из сообщения: автоотправка", () => {
  it("последняя цифра — отправить один раз", () => {
    const first = codeAutoSubmit("123456", 6, null);
    expect(first).toEqual({ submit: true, sent: "123456" });
    // Тот же код ещё раз (повторное событие, ошибка проверки) — не отправлять.
    expect(codeAutoSubmit("123456", 6, first.sent)).toEqual({ submit: false, sent: "123456" });
  });

  it("код подставлен целиком с пробелом («123 456») — тоже отправить", () => {
    expect(codeAutoSubmit("123 456", 6, null).submit).toBe(true);
  });

  it("неполный код — не отправлять и забыть прошлую отправку: снова набранный код уходит", () => {
    const partial = codeAutoSubmit("12345", 6, "123456");
    expect(partial).toEqual({ submit: false, sent: null });
    expect(codeAutoSubmit("123456", 6, partial.sent).submit).toBe(true);
  });

  it("другой полный код после ошибки — отправить", () => {
    expect(codeAutoSubmit("654321", 6, "123456")).toEqual({ submit: true, sent: "654321" });
  });

  it("длина задаётся", () => {
    expect(codeAutoSubmit("1234", 4, null).submit).toBe(true);
    expect(codeAutoSubmit("1234", 6, null).submit).toBe(false);
  });
});

describe("почта: подсказка опечатки в домене", () => {
  it.each([
    ["aigerim@gmial.com", "aigerim@gmail.com"],
    ["a@gmail.co", "a@gmail.com"],
    ["a@mail.ri", "a@mail.ru"],
    ["a@yandex.ry", "a@yandex.ru"],
    ["a@yandex.kx", "a@yandex.kz"],
    ["a@inbox.ri", "a@inbox.ru"],
    ["a@icloud.cm", "a@icloud.com"],
    ["a@outlok.com", "a@outlook.com"],
    ["a@hotmial.com", "a@hotmail.com"],
    ["a@bk.ry", "a@bk.ru"],
    ["a@GMAIL.CON", "a@gmail.com"],
    ["a@gmail", "a@gmail.com"],
  ])("«%s» → «%s»", (email, suggestion) => {
    expect(suggestEmail(email)).toBe(suggestion);
  });

  it.each(["a@gmail.com", "a@mail.ru", "a@ya.ru", "a@mail.kz", "a@company.kz", "a@nu.edu.kz", "aigerim", "@gmail.com", "a@", ""])(
    "«%s» — без подсказки",
    (email) => {
      expect(suggestEmail(email)).toBeNull();
    },
  );

  it("расстояние правки", () => {
    expect(editDistance("gmial.com", "gmail.com")).toBe(2);
    expect(editDistance("mail.ri", "mail.ru")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("Instagram: имя или ссылка", () => {
  it.each([
    ["dala.mebel", "dala.mebel"],
    ["@dala.mebel", "dala.mebel"],
    [" @dala ", "dala"],
    ["https://www.instagram.com/dala.mebel?igsh=MTFxY2V4", "dala.mebel"],
    ["https://instagram.com/dala_mebel/", "dala_mebel"],
    ["instagram.com/dala", "dala"],
    ["Смотрите instagram.com/dala.mebel", "dala.mebel"],
    // Ссылка ещё набирается, имени в ней нет — строка не меняется (кроме пробелов).
    ["https://instagram.com/", "https://instagram.com/"],
    ["", ""],
  ])("«%s» → «%s»", (raw, name) => {
    expect(instagramName(raw)).toBe(name);
  });
});
