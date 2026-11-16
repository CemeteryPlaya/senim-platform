import { describe, expect, it } from "vitest";
import { fitSize, MAX_SIDE, resizePhoto } from "./resize";

describe("fitSize", () => {
  it.each([
    [4032, 3024, { width: 2560, height: 1920 }],
    [3024, 4032, { width: 1920, height: 2560 }],
    [8000, 2000, { width: 2560, height: 640 }],
    [2560, 1000, null],
    [800, 600, null],
    [0, 3000, null],
  ])("%d × %d", (width, height, expected) => {
    expect(fitSize(width, height)).toEqual(expected);
  });

  it("предел задаётся параметром", () => {
    expect(fitSize(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(MAX_SIDE).toBe(2560);
  });
});

describe("resizePhoto", () => {
  it.each([
    ["HEIC", "image/heic"],
    ["PDF", "application/pdf"],
    ["GIF", "image/gif"],
  ])("%s уходит как есть", async (_name, type) => {
    const file = new File(["x"], "a", { type });
    expect(await resizePhoto(file)).toBe(file);
  });

  it("без createImageBitmap (или при сбое) — исходный файл", async () => {
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    expect(await resizePhoto(file)).toBe(file);
  });
});
