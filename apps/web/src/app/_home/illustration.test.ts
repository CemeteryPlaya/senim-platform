import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { illustration, illustrationFor } from "./illustration";

describe("иллюстрация по названию мебели", () => {
  it.each([
    ["Кухня угловая", "/img/kitchen.svg"],
    ["Шкаф-купе в спальню", "/img/wardrobe.svg"],
    ["Гардеробная", "/img/closet.svg"],
    ["Прихожая", "/img/hallway.svg"],
    ["Тумба в санузел", "/img/bathroom.svg"],
    ["Детская", "/img/kids.svg"],
  ])("%s → %s", (title, src) => {
    expect(illustrationFor(title)).toBe(src);
  });

  it("незнакомое название — без картинки, карточка покажет заглушку", () => {
    expect(illustrationFor("Что-то особенное")).toBeNull();
  });

  it("каждый файл, на который ведут названия и ключи лендинга, есть в public/img", () => {
    const srcs = ["кухня", "гардероб", "прихожая", "ванная", "детская", "стол", "офис", "шкаф"].map((w) => illustrationFor(w));
    for (const src of [...srcs, illustration("workshop"), illustration("measure")]) {
      expect(src).not.toBeNull();
      expect(existsSync(path.join(process.cwd(), "public", src!))).toBe(true);
    }
  });
});
