import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/crypto";
import { renderPdf } from "./render";
import type { PdfSpec } from "./spec";

const spec = (over: Partial<PdfSpec> = {}): PdfSpec => ({
  title: "Договор подряда № Д-0001/2026",
  issuedAt: new Date("2026-10-30T06:00:00Z"),
  footer: "Договор № Д-0001/2026, версия 1",
  blocks: [
    { kind: "title", text: "ДОГОВОР ПОДРЯДА № Д-0001/2026" },
    { kind: "subtitle", text: "версия 1 · г. Астана" },
    { kind: "heading", text: "1. Предмет договора" },
    { kind: "paragraph", text: "ТОО «Ағаш Шебер», БИН 210140012345 — Ёё Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі. Цена — 1 250 000 ₸." },
    {
      kind: "table",
      columns: [
        { header: "№", width: 0.1 },
        { header: "Этап", width: 0.6 },
        { header: "Сумма", width: 0.3, align: "right" },
      ],
      rows: [["1", "Изготовление корпуса и фасадов с очень длинным описанием, которое переносится на несколько строк", "625 000 ₸"]],
    },
    { kind: "signatures", parties: [{ role: "Заказчик", name: "Сапарова Айгерим" }, { role: "Исполнитель", name: "ТОО «Ағаш Шебер»" }] },
  ],
  ...over,
});

/** Все кодовые точки из CMap ToUnicode встроенных шрифтов: так проверяем, что кириллица легла глифами шрифта. */
async function unicodeCodePoints(bytes: Uint8Array): Promise<Set<number>> {
  const doc = await PDFDocument.load(bytes);
  const points = new Set<number>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const text = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    if (!text.includes("beginbfchar") && !text.includes("beginbfrange")) continue;
    for (const m of text.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g)) points.add(parseInt(m[2].slice(0, 4), 16));
  }
  return points;
}

describe("renderPdf", () => {
  it("строит PDF с кириллицей и казахскими буквами встроенным шрифтом", async () => {
    const bytes = await renderPdf(spec());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Договор подряда № Д-0001/2026");
    const points = await unicodeCodePoints(bytes);
    for (const ch of ["Д", "ә", "Ғ", "ұ", "₸", "«"]) expect(points.has(ch.codePointAt(0)!)).toBe(true);
  });

  it("одинаковые данные дают одинаковые байты (стабильный хэш)", async () => {
    const [a, b] = await Promise.all([renderPdf(spec()), renderPdf(spec())]);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("другая дата формирования — другой хэш", async () => {
    const a = await renderPdf(spec());
    const b = await renderPdf(spec({ issuedAt: new Date("2026-10-31T06:00:00Z") }));
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });

  it("длинный текст переносится на следующие страницы", async () => {
    const long = Array.from({ length: 80 }, (_, i) => ({ kind: "paragraph" as const, text: `${i + 1}. Длинный пункт договора, который занимает место на странице и проверяет перенос.` }));
    const doc = await PDFDocument.load(await renderPdf(spec({ blocks: long })));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
