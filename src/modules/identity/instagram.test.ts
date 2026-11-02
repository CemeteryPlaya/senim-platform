import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { INSTAGRAM_MAX, instagramField } from "./instagram";

const parse = (raw: string) => instagramField.safeParse(raw);

describe("Instagram: имя без «@» — латиница, цифры, точка, подчёркивание, до 30", () => {
  it.each([
    ["dala_mebel", "dala_mebel"],
    ["@dala.mebel", "dala.mebel"],
    ["  @Aigerim.Home_2  ", "Aigerim.Home_2"],
    ["a", "a"],
    ["x".repeat(INSTAGRAM_MAX), "x".repeat(INSTAGRAM_MAX)],
  ])("%j → %j", (raw, expected) => {
    expect(parse(raw)).toEqual({ success: true, data: expected });
  });

  it("пустое поле (и одна «@») — Instagram не указан", () => {
    expect(parse("")).toEqual({ success: true, data: null });
    expect(parse("   ")).toEqual({ success: true, data: null });
    expect(parse("@")).toEqual({ success: true, data: null });
  });

  it.each([
    ["кириллица", "дала_мебель"],
    ["пробел", "dala mebel"],
    ["дефис", "dala-mebel"],
    ["ссылка", "https://instagram.com/dala"],
    ["две «@»", "@@dala"],
    ["длиннее 30", "x".repeat(INSTAGRAM_MAX + 1)],
  ])("%s — ошибка", (_, raw) => {
    expect(parse(raw).success).toBe(false);
  });

  it("сообщение ошибки — понятное, под полем формы", () => {
    expect(parse("дала").error?.issues[0]?.message).toBe(ru.identity.contacts.instagramInvalid);
    expect(parse("x".repeat(INSTAGRAM_MAX + 1)).error?.issues[0]?.message).toBe(ru.identity.contacts.instagramTooLong(INSTAGRAM_MAX));
  });
});
