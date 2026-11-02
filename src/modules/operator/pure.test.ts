import { describe, expect, it } from "vitest";
import { csvDateTime, csvTiyn, toCsv } from "./csv";
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
    expect(toCsv(["A", "B"], [[undefined, "a=b+c"]]).endsWith("\r\n;a=b+c\r\n")).toBe(true);
  });

  it("дата и время — по Астане, пустая дата — пустая ячейка", () => {
    expect(csvDateTime(new Date("2026-10-30T09:05:00.000Z"))).toBe("2026-10-30 14:05");
    expect(csvDateTime(null)).toBe("");
    expect(csvDateTime(undefined)).toBe("");
  });
});

describe("суммы в CSV", () => {
  it("тиыны — тенге с двумя знаками после запятой", () => {
    expect([153_000_000n, 5n, 0n, 1_250n].map(csvTiyn)).toEqual(["1530000,00", "0,05", "0,00", "12,50"]);
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
