import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { slugify } from "./slug";

describe("CSV", () => {
  it("экранирует кавычки, разделитель и переносы строк", () => {
    expect(toCsv(["A", "B"], [['он сказал "да"', "1;2"], ["строка\nвторая", 5]])).toBe(
      '﻿A;B\r\n"он сказал ""да""";"1;2"\r\n"строка\nвторая";5\r\n',
    );
  });

  it("обезвреживает ячейки, которые Excel принял бы за формулу", () => {
    expect(toCsv(["A"], [["=HYPERLINK(1)"], ["+7"], ["-1"], ["@x"]])).toBe("﻿A\r\n'=HYPERLINK(1)\r\n'+7\r\n'-1\r\n'@x\r\n");
  });

  it("числа и пустые значения пишет как есть", () => {
    expect(toCsv(["A", "B"], [[-150, null]])).toBe("﻿A;B\r\n-150;\r\n");
  });
});

describe("slug типа мебели", () => {
  it("транслитерирует кириллицу", () => {
    expect(slugify("Мебель для балкона")).toBe("mebel-dlya-balkona");
    expect(slugify("Шкаф-купе №2")).toBe("shkaf-kupe-2");
  });

  it("не возвращает пустую строку", () => {
    expect(slugify("!!!")).toBe("type");
  });
});
