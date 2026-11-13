import { describe, expect, it } from "vitest";
import { secondsLeft } from "./countdown";

describe("secondsLeft", () => {
  it.each([
    [60_000, 60],
    [59_001, 60],
    [59_000, 59],
    [1, 1],
    [0, 0],
    [-5_000, 0],
  ])("до срока %i мс — %i с", (ms, seconds) => {
    expect(secondsLeft(1_000_000 + ms, 1_000_000)).toBe(seconds);
  });
});
