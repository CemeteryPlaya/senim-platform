import { describe, expect, it } from "vitest";
import { astanaDate } from "./astana";

describe("astanaDate: календарная дата по Астане", () => {
  it("до полуночи по Астане — тот же день, после — следующий", () => {
    expect(astanaDate(new Date("2026-11-17T18:59:59Z"))).toBe("2026-11-17");
    expect(astanaDate(new Date("2026-11-17T19:00:00Z"))).toBe("2026-11-18");
  });
});
