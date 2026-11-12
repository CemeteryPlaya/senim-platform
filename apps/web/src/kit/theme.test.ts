import { describe, expect, it } from "vitest";
import { parseTheme, THEME_COOKIE } from "./theme";

describe("выбор темы из куки", () => {
  it("принимает только известные значения", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
  });

  it("всё остальное — как в системе", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("<script>")).toBe("system");
    expect(parseTheme("Dark")).toBe("system");
    expect(parseTheme(" dark")).toBe("system");
  });

  it("кука называется theme", () => {
    expect(THEME_COOKIE).toBe("theme");
  });
});
