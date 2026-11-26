import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { CodeField, EmailField, IbanField, IinField, InstagramField, MoneyField, PhoneField, TextField } from "@/kit";
import { hasClass, html } from "@/kit/test-utils";

const NBSP = " ";

/** Видимое поле (не скрытое) и скрытое поле формы с именем `name`. */
function inputs(out: string, name: string): { visible: string; hidden: string | undefined } {
  const visible = /<input(?![^>]*type="hidden")[^>]*>/.exec(out)?.[0] ?? "";
  const hidden = new RegExp(`<input[^>]*type="hidden"[^>]*name="${name}"[^>]*>`).exec(out)?.[0];
  return { visible, hidden };
}

const attr = (tag: string, name: string, value: string) => new RegExp(String.raw`\s${name}="${value}"`, "i").test(tag);

describe("MoneyField", () => {
  const out = html(<MoneyField label="Ваша цена" name="price" defaultTiyn={120_000_000n} under={<p>Вы получите</p>} />);
  const { visible, hidden } = inputs(out, "price");

  it("показ — разряды через неразрывный пробел; в форму — цифры целых тенге без пробелов", () => {
    expect(visible).toContain(`value="1${NBSP}200${NBSP}000"`);
    expect(hidden).toContain('value="1200000"');
    expect(visible).toContain('data-field="price"');
  });

  it("цифровая клавиатура, без автозаполнения; «₸» в поле, для диктора скрыт; строка расчёта под полем", () => {
    expect(attr(visible, "inputmode", "numeric")).toBe(true);
    expect(attr(visible, "autocomplete", "off")).toBe(true);
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>₸<\/span>/);
    expect(hasClass(out, "pr-10")).toBe(true);
    expect(out).toContain("<p>Вы получите</p>");
  });

  it("шрифт поля — text-body (17 px: iOS не увеличивает страницу при фокусе)", () => {
    expect(visible).toMatch(/class="[^"]*\btext-body\b/);
  });

  it("пустое поле — пустое значение для формы", () => {
    expect(inputs(html(<MoneyField label="Цена" name="price" />), "price").hidden).toContain('value=""');
  });
});

describe("IinField и IbanField", () => {
  it("ИИН: группы 6-3-3, в форму — цифры; цифровая клавиатура", () => {
    const out = html(<IinField label="ИИН" name="iin" defaultValue="870304300612" />);
    const { visible, hidden } = inputs(out, "iin");
    expect(visible).toContain('value="870304 300 612"');
    expect(hidden).toContain('value="870304300612"');
    expect(attr(visible, "inputmode", "numeric")).toBe(true);
  });

  it("ошибка с сервера у поля связана с ним", () => {
    const out = html(<IinField label="БИН" name="binIin" kind="bin" error="Проверьте БИН" />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("Проверьте БИН");
  });

  it("IBAN: заглавные и группы по 4, в форму — 20 знаков без пробелов; заглавные на клавиатуре", () => {
    const out = html(<IbanField label="IBAN" name="iban" defaultValue="kz86125kzt5004100100" />);
    const { visible, hidden } = inputs(out, "iban");
    expect(visible).toContain('value="KZ86 125K ZT50 0410 0100"');
    expect(hidden).toContain('value="KZ86125KZT5004100100"');
    expect(attr(visible, "autocapitalize", "characters")).toBe(true);
    expect(attr(visible, "autocorrect", "off")).toBe(true);
    expect(attr(visible, "spellcheck", "false")).toBe(true);
  });
});

describe("EmailField и InstagramField", () => {
  it("почта: имя у самого поля, клавиатура с «@», без автоисправления; подсказки пока нет — живая область пустая, место под неё занято", () => {
    const out = html(<EmailField label="Почта" name="email" defaultValue="a@mail.ru" />);
    const { visible } = inputs(out, "email");
    expect(attr(visible, "name", "email")).toBe(true);
    expect(attr(visible, "type", "email")).toBe(true);
    expect(attr(visible, "autocomplete", "email")).toBe(true);
    expect(attr(visible, "autocapitalize", "none")).toBe(true);
    expect(attr(visible, "autocorrect", "off")).toBe(true);
    // Строка подсказки занята заранее (min-h-hint: 48px и две строки): её появление не сдвигает кнопку под курсором.
    expect(out).toContain('<div aria-live="polite" class="min-h-hint text-body"></div>');
  });

  it("текст подсказки — из ru", () => {
    expect(ru.app.kit.fields.emailSuggest("a@gmail.com")).toBe("Возможно, вы имели в виду a@gmail.com?");
  });

  it("Instagram: «@» в поле, в поле — имя из ссылки, без автоисправления", () => {
    const out = html(<InstagramField label="Instagram" name="instagram" defaultValue="https://instagram.com/dala.mebel?igsh=x" />);
    const { visible } = inputs(out, "instagram");
    expect(attr(visible, "name", "instagram")).toBe(true);
    expect(visible).toContain('value="dala.mebel"');
    expect(attr(visible, "autocorrect", "off")).toBe(true);
    expect(attr(visible, "autocapitalize", "none")).toBe(true);
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>@<\/span>/);
  });
});

describe("labelHidden: экран с одним полем", () => {
  it("подпись — только для диктора (sr-only) и по-прежнему связана с полем; по умолчанию видимая", () => {
    for (const out of [
      html(<PhoneField label="Номер телефона" name="phone" labelHidden />),
      html(<CodeField label="Код" name="code" labelHidden />),
      html(<EmailField label="Почта" name="email" labelHidden />),
      html(<TextField label="Имя" name="name" labelHidden />),
    ]) {
      const label = /<label for="([^"]+)" class="([^"]*)"/.exec(out);
      expect(label?.[2]).toBe("sr-only");
      expect(out).toContain(`id="${label?.[1]}"`);
    }
    expect(/<label [^>]*class="([^"]*)"/.exec(html(<PhoneField label="Номер" name="phone" />))?.[1]).not.toBe("sr-only");
  });
});
