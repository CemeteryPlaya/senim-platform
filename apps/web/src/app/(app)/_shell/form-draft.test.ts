import { describe, expect, it } from "vitest";
import { draftKey, isFilled, mergeDraft } from "./form-draft";

const empty = { price: "", days: "", warranty: "12", comment: "" };

describe("черновик формы", () => {
  it("ключ — форма и объект", () => {
    expect(draftKey("offer", "req1")).toBe("senim.draft:offer:req1");
  });

  it.each([
    [{ price: "1200000", days: "30" }, { price: "1200000", days: "30", warranty: "12", comment: "" }],
    [{ price: 5, days: "30" }, { ...empty, days: "30" }],
    [{ other: "x", comment: "Привет" }, { ...empty, comment: "Привет" }],
    [null, empty],
    [["a"], empty],
    ["x", empty],
  ])("сохранённое %j поверх пустого", (saved, expected) => {
    expect(mergeDraft(empty, saved)).toEqual(expected);
  });

  it("заполнена ли форма: значение по умолчанию (гарантия 12) не считается вводом", () => {
    expect(isFilled(empty, empty)).toBe(false);
    expect(isFilled({ ...empty, comment: "a" }, empty)).toBe(true);
    expect(isFilled({ ...empty, warranty: "6" }, empty)).toBe(true);
  });
});
