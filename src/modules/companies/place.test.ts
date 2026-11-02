import { describe, expect, it } from "vitest";
import { isPlaceAllowed } from "./place";

describe("место работы: город, район или ЖК — не точный адрес", () => {
  it.each([
    "Астана",
    "Астана, Есильский район",
    "ЖК «Хайвил»",
    "Алматы, мкр Самал-2",
    "ЖК Highvill 2",
    "Косшы",
  ])("можно: %s", (place) => {
    expect(isPlaceAllowed(place)).toBe(true);
  });

  it.each([
    "ул. Абая 10",
    "Астана, улица Кенесары, д. 5",
    "пр-т Мангилик Ел 55",
    "проспект Республики",
    "Есильский район, кв. 12",
    "Абая 10/2",
    "дом 7, подъезд 2",
    "+7 701 123 45 67",
    "пишите в WhatsApp",
  ])("нельзя: %s", (place) => {
    expect(isPlaceAllowed(place)).toBe(false);
  });
});
