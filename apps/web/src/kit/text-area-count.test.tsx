import { describe, expect, it } from "vitest";
import { TextArea } from "./fields";
import { html, text } from "./test-utils";

const area = (value: string, extra: { minLength?: number; maxLength?: number } = {}) => (
  <TextArea label="Описание" name="d" value={value} onChange={() => {}} {...extra} />
);

describe("TextArea: строка счёта под полем", () => {
  it("до минимума — «Ещё N символов», но только когда человек начал писать", () => {
    expect(text(area("", { minLength: 10 }))).not.toContain("Ещё");
    expect(text(area("Не", { minLength: 10 }))).toContain("Ещё 8 символов");
    expect(text(area("Привет, ", { minLength: 10 }))).toContain("Ещё 3 символа");
    expect(text(area("123456789", { minLength: 10 }))).toContain("Ещё 1 символ");
    expect(text(area("1234567890", { minLength: 10 }))).not.toContain("Ещё");
  });

  it("минимум считается без пробелов по краям", () => {
    expect(text(area("   ab   ", { minLength: 10 }))).toContain("Ещё 8 символов");
  });

  it("у предела — «N из M» с 80 % и красным сверх предела", () => {
    expect(text(area("x".repeat(79), { maxLength: 100 }))).not.toContain("из");
    expect(text(area("x".repeat(80), { maxLength: 100 }))).toContain("80 из 100");
    expect(html(area("x".repeat(101), { maxLength: 100 }))).toContain("text-danger");
  });

  it("строка связана с полем (aria-describedby), `minLength` в разметку не попадает", () => {
    const out = html(area("Не", { minLength: 10, maxLength: 100 }));
    expect(out).toMatch(/aria-describedby="([^"]+)-count"/);
    expect(out).not.toContain("minLength");
  });

  it("неуправляемое поле счёта не показывает", () => {
    expect(text(<TextArea label="Описание" name="d" maxLength={100} minLength={10} />)).not.toMatch(/из|Ещё/);
  });
});
