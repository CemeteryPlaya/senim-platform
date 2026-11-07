import { describe, expect, it } from "vitest";
import { INSPIRATION_MAX, INSPIRATION_STEP, inspirationHref, parseInspirationFilter } from "./inspiration-filter";

describe("фильтр «Вдохновения» в адресе", () => {
  it("без параметров — первая порция, без фильтров", () => {
    expect(parseInspirationFilter({})).toEqual({ limit: INSPIRATION_STEP });
  });

  it("тип, стиль и сколько показать", () => {
    expect(parseInspirationFilter({ type: "kitchen", style: "loft", n: String(INSPIRATION_STEP * 2) })).toEqual({
      type: "kitchen",
      style: "loft",
      limit: INSPIRATION_STEP * 2,
    });
  });

  it("неизвестные и вредные значения отбрасываются, n — в пределах", () => {
    expect(parseInspirationFilter({ type: "<script>", style: "baroque", n: "-5" })).toEqual({ limit: INSPIRATION_STEP });
    expect(parseInspirationFilter({ n: "100000" })).toEqual({ limit: INSPIRATION_MAX });
    expect(parseInspirationFilter({ n: "abc" })).toEqual({ limit: INSPIRATION_STEP });
    expect(parseInspirationFilter({ type: ["wardrobe", "kitchen"] })).toEqual({ type: "wardrobe", limit: INSPIRATION_STEP });
  });

  it("ссылка: первая порция не пишется, порядок параметров постоянный", () => {
    expect(inspirationHref({ limit: INSPIRATION_STEP })).toBe("/inspiration");
    expect(inspirationHref({ style: "scandi", type: "kitchen", limit: INSPIRATION_STEP * 3 })).toBe(`/inspiration?type=kitchen&style=scandi&n=${INSPIRATION_STEP * 3}`);
  });
});
