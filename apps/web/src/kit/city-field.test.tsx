import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { CityField } from "./CityField";
import { html } from "./test-utils";

const CITIES = ["Алматы", "Астана", "Шымкент", "Караганда"] as const;
const field = (value: string, extra: { quick?: number; error?: string } = {}) => (
  <CityField label="Город" name="city" suggestions={CITIES} value={value} onChange={() => {}} {...extra} />
);

describe("CityField", () => {
  const out = html(field(""));

  it("подсказка — datalist со всеми городами, поле связано с ним; свой вариант не запрещён (нет pattern и required)", () => {
    expect(out).toMatch(/<input[^>]*list="([^"]+)-cities"/);
    expect(out).toContain("<datalist");
    for (const city of CITIES) expect(out).toContain(`<option value="${city}"`);
    expect(out).not.toContain("pattern=");
  });

  it("атрибуты ввода: автозаполнение города, заглавные слова, без автоисправления", () => {
    expect(out).toContain('autoComplete="address-level2"');
    expect(out).toContain('autoCapitalize="words"');
    expect(out).toContain('autoCorrect="off"');
  });

  it("под пустым полем — первые три города кнопками; под заполненным — нет", () => {
    expect(out).toMatch(/<button[^>]*>.*Алматы.*<\/button>/);
    expect(out).toMatch(/<button[^>]*>.*Шымкент.*<\/button>/);
    expect(out).not.toMatch(/<button[^>]*>.*Караганда.*<\/button>/);
    expect(html(field("Алм"))).not.toMatch(/<button[^>]*>.*Алматы.*<\/button>/);
    expect(html(field("", { quick: 0 }))).not.toMatch(/<button[^>]*>.*Алматы.*<\/button>/);
  });

  it("кнопка со стрелкой в поле открывает весь список городов — и у пустого, и у заполненного поля", () => {
    for (const value of ["", "Астана"]) {
      const withList = html(field(value));
      expect(withList).toMatch(new RegExp(`<button[^>]*aria-label="${ru.app.kit.cityList.open}"[^>]*aria-haspopup="dialog"`));
    }
  });

  it("ошибка — у поля", () => {
    const withError = html(field("", { error: "Укажите город" }));
    expect(withError).toContain("Укажите город");
    expect(withError).toContain('aria-invalid="true"');
  });
});
