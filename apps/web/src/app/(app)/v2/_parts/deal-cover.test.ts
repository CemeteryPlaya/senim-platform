import { describe, expect, it } from "vitest";
import { coverOf, mayHaveReports } from "./deal-cover";

const report = (id: string, createdAt: string, photos: string[]) => ({
  id,
  title: `Отчёт ${id}`,
  text: "",
  createdAt: new Date(createdAt),
  photos: photos.map((src, index) => ({ id: `${id}-${index}`, src })),
});

describe("обложка героя сделки", () => {
  it("читаем сделку только в статусах, где бывают отчёты хода работ", () => {
    for (const status of ["IN_PROGRESS", "READY", "ACCEPTED", "SPLIT_PAYOUT"] as const) expect(mayHaveReports(status)).toBe(true);
    for (const status of ["CREATED", "PAID_HOLD", "CANCELLED", "REFUNDED"] as const) expect(mayHaveReports(status)).toBe(false);
  });

  it("самый свежий отчёт с фото — его первое фото; отчётов с фото нет — без обложки", () => {
    const reports = [report("a", "2026-11-01T10:00:00Z", ["/a.webp"]), report("b", "2026-11-05T10:00:00Z", ["/b1.webp", "/b2.webp"]), report("c", "2026-11-07T10:00:00Z", [])];
    expect(coverOf(reports)).toMatchObject({ src: "/b1.webp" });
    expect(coverOf([report("c", "2026-11-07T10:00:00Z", [])])).toBeNull();
    expect(coverOf([])).toBeNull();
  });
});
