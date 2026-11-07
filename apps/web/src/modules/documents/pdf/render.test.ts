import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/crypto";
import { acceptanceActSpec } from "../templates/acceptance-act";
import { contractSpec } from "../templates/contract";
import { appendPages, renderPdf } from "./render";
import type { PdfSpec } from "./spec";

/** Минимальный PNG 1×1 (прозрачный пиксель). */
const PNG_1X1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

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
    {
      kind: "signatures",
      parties: [
        { role: "Заказчик", name: "Сапарова Айгерим", caption: "Подпись — в листе подписей" },
        { role: "Исполнитель", name: "ТОО «Ағаш Шебер»", caption: "Подпись — в листе подписей" },
      ],
    },
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

/**
 * Символы, у которых во встроенной программе шрифта (FontFile2) пустой контур: такой символ
 * есть в тексте PDF, но на странице — пробел. Связь символа с глифом — из CMap ToUnicode того же шрифта.
 */
function outline(font: ReturnType<typeof fontkit.create>, glyphId: number): string {
  try {
    return font.getGlyph(glyphId).path.toSVG();
  } catch {
    return ""; // составной глиф ссылается на компонент, которого нет в подмножестве
  }
}

function rawStream(dict: PDFDict, key: string): PDFRawStream {
  const stream = dict.lookup(PDFName.of(key), PDFStream);
  if (!(stream instanceof PDFRawStream)) throw new Error(`${key}: ожидался поток`);
  return stream;
}

async function blankGlyphs(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const blank: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of("Subtype")) !== PDFName.of("Type0")) continue;
    const toUnicode = rawStream(obj, "ToUnicode");
    const descendant = obj.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
    const file = rawStream(descendant.lookup(PDFName.of("FontDescriptor"), PDFDict), "FontFile2");
    const font = fontkit.create(decodePDFRawStream(file).decode());
    const cmap = Buffer.from(decodePDFRawStream(toUnicode).decode()).toString("latin1");
    for (const m of cmap.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,8})>/g)) {
      const char = String.fromCodePoint(parseInt(m[2].slice(0, 4), 16));
      const visible = /[\p{L}\p{N}\p{P}\p{S}]/u.test(char); // пробелы и служебные глифы контура не имеют
      if (visible && !outline(font, parseInt(m[1], 16))) blank.push(char);
    }
  }
  return blank;
}

/** Имена встроенных шрифтов (BaseFont): у подмножества — префикс вида «ABCDEF+». */
function baseFonts(bytes: Uint8Array): string[] {
  return [...Buffer.from(bytes).toString("latin1").matchAll(/\/BaseFont \/([A-Za-z0-9+-]+)/g)].map((m) => m[1]);
}

/** Все вызовы drawText: кегль (Tf) и позиция базовой линии (Tm) из потоков содержимого страниц. */
async function textOps(bytes: Uint8Array): Promise<{ size: number; x: number; y: number }[]> {
  const doc = await PDFDocument.load(bytes);
  const ops: { size: number; x: number; y: number }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const text = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
    for (const m of text.matchAll(/\/\S+ ([\d.]+) Tf\s+[\d.]+ TL[\s\S]*?([\d.-]+) ([\d.-]+) Tm/g)) {
      ops.push({ size: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
    }
  }
  return ops;
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

  it("встраивает Tinos (метрический аналог Times New Roman) и рисует весь казахский алфавит", async () => {
    const kazakh = "АаӘәБбВвГгҒғДдЕеЁёЖжЗзИиЙйКкҚқЛлМмНнҢңОоӨөПпРрСсТтУуҰұҮүФфХхҺһЦцЧчШшЩщЪъЫыІіЬьЭэЮюЯя";
    const bytes = await renderPdf(spec({ blocks: [{ kind: "paragraph", text: `${kazakh} № «» — ₸` }, { kind: "heading", text: kazakh }] }));
    const fonts = baseFonts(bytes);
    expect(fonts.some((f) => /(^|\+)Tinos-Regular$/.test(f))).toBe(true);
    expect(fonts.some((f) => /(^|\+)Tinos-Bold$/.test(f))).toBe(true);
    const points = await unicodeCodePoints(bytes);
    for (const ch of `${kazakh}№«»—₸`) expect(points.has(ch.codePointAt(0)!), ch).toBe(true);
    // Кириллица в Tinos собрана из составных глифов (А = латинская A); у каждой буквы должен быть контур.
    expect(await blankGlyphs(bytes)).toEqual([]);
  });

  it("основной текст и заголовки — 14 pt, мелкие подписи не меньше 12 pt", async () => {
    const sizes = (await textOps(await renderPdf(spec()))).map((op) => op.size);
    expect(new Set(sizes)).toEqual(new Set([12, 14]));
    const body = await textOps(await renderPdf(spec({ blocks: [{ kind: "heading", text: "1. Предмет" }, { kind: "paragraph", text: "Текст пункта." }] })));
    expect(body.filter((op) => op.size === 14)).toHaveLength(2);
  });

  it("поля: левое 30 мм, текст не заходит в верхнее и нижнее поле 20 мм", async () => {
    const mm = 72 / 25.4;
    const ops = await textOps(await renderPdf(spec()));
    const left = Math.min(...ops.map((op) => op.x));
    expect(left).toBeCloseTo(30 * mm, 1);
    const body = ops.filter((op) => op.size === 14);
    expect(Math.max(...body.map((op) => op.y + op.size))).toBeLessThanOrEqual(841.89 - 20 * mm + 0.01);
    expect(Math.min(...body.map((op) => op.y))).toBeGreaterThanOrEqual(20 * mm);
  });

  it("оферта и акт с длинными наименованиями, крупными суммами и фото раскладываются без выхода за поля", async () => {
    const longName = "Товарищество с ограниченной ответственностью «Солтүстік Қазақстан Жиһаз Өндірісі және Монтаж Қызметі»";
    const money = { priceTiyn: 99_999_999_99n, protectionTiyn: 2_000_000_00n, buyerTotalTiyn: 101_999_999_99n, guaranteeTiyn: 4_000_000_00n, payoutTiyn: 95_999_999_99n, platformIncomeTiyn: 6_000_000_00n };
    const contract = contractSpec({
      number: "Д-0014/2026",
      version: 3,
      issuedAt: new Date("2026-10-30T06:00:00Z"),
      city: "Өскемен",
      client: { fullName: "Сапарова-Нұрмағамбетова Айгерим Болатқызы", iin: "900101300123" },
      executor: { legalForm: "TOO", legalName: longName, binIin: "210140012345", signerFullName: "Тулегенов Бауыржан Серикович" },
      subject: { title: "Кухня угловая", details: ["Ширина: 320 см"], address: "ул. Кенесары, 40, кв. 12" },
      money,
      durationDays: 45,
      warrantyMonths: 24,
      provider: "MOCK",
      isDemo: true,
    });
    const act = acceptanceActSpec({
      number: "А-0014",
      version: 1,
      issuedAt: new Date("2026-11-20T06:00:00Z"),
      city: "Өскемен",
      contractNumber: "Д-0014/2026",
      dealTitle: "Кухня угловая",
      clientName: "Сапарова-Нұрмағамбетова Айгерим Болатқызы",
      executorName: longName,
      money,
      readyAt: new Date("2026-11-19T10:00:00Z"),
      photos: [{ image: { bytes: PNG_1X1, format: "png" }, sha256: "a".repeat(64) }, { image: null, sha256: "b".repeat(64) }, { image: { bytes: new Uint8Array([1, 2, 3]), format: "jpg" }, sha256: "c".repeat(64) }],
      gps: { distanceM: 1800, withinRadius: false, radiusM: 500, accuracyM: 30 },
      executorHandSigns: true,
      isDemo: true,
    });
    // Рендер бросает исключение, если строка выходит за правое поле, — здесь его быть не должно.
    for (const doc of [contract, act]) {
      const pdf = await PDFDocument.load(await renderPdf(doc));
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("встраивает фото и подпись картинками; повреждённый файл не роняет документ", async () => {
    const bytes = await renderPdf(
      spec({
        blocks: [
          { kind: "photos", items: [{ image: { bytes: PNG_1X1, format: "png" }, caption: "Фото 1" }, { image: { bytes: new Uint8Array([9, 9]), format: "jpg" }, caption: "Фото 2" }] },
          { kind: "image", image: { bytes: PNG_1X1, format: "png" }, maxHeight: 90, caption: "Подпись" },
          { kind: "notice", text: "ШАБЛОН ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ" },
        ],
      }),
    );
    // У PNG с прозрачностью pdf-lib добавляет маску (тоже /Subtype /Image) — её не считаем.
    const raw = Buffer.from(bytes).toString("latin1");
    const count = (re: RegExp) => (raw.match(re) ?? []).length;
    expect(count(/\/Subtype \/Image/g) - count(/\/SMask \d+ 0 R/g)).toBe(2);
  });

  it("подписанная копия: исходные страницы без изменений плюс лист; одинаковые данные — одинаковые байты", async () => {
    const original = await renderPdf(spec());
    const sheet = await renderPdf(spec({ title: "Лист подписей", blocks: [{ kind: "title", text: "ЛИСТ ПОДПИСЕЙ" }] }));
    const at = new Date("2026-11-01T06:00:00Z");
    const [a, b] = await Promise.all([appendPages(original, sheet, at), appendPages(original, sheet, at)]);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const [orig, copy] = await Promise.all([PDFDocument.load(original), PDFDocument.load(a)]);
    expect(copy.getPageCount()).toBe(orig.getPageCount() + 1);
    expect(copy.getTitle()).toBe(orig.getTitle());
  });

  it("длинный текст переносится на следующие страницы", async () => {
    const long = Array.from({ length: 80 }, (_, i) => ({ kind: "paragraph" as const, text: `${i + 1}. Длинный пункт договора, который занимает место на странице и проверяет перенос.` }));
    const doc = await PDFDocument.load(await renderPdf(spec({ blocks: long })));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
