import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

/**
 * Текст PDF без отдельной библиотеки (pdf-parse в зависимостях нет): документы Сенім рисует pdf-lib
 * встроенным шрифтом Type0, глифы в потоке — hex-коды, буквы — из CMap ToUnicode того же шрифта.
 * Каждый вызов Tj/TJ — отдельная строка результата. Достаточно, чтобы найти суммы и номера.
 */

type CMap = Map<number, string>;

function bytesOf(stream: PDFObject | undefined, doc: PDFDocument): string {
  const s = stream instanceof PDFRef ? doc.context.lookup(stream) : stream;
  if (!(s instanceof PDFRawStream)) return "";
  return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
}

/** bfchar и bfrange CMap ToUnicode: код глифа → символы. */
function parseCMap(text: string): CMap {
  const map: CMap = new Map();
  const utf16 = (hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const [from, to, start] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
      for (let c = from; c <= to; c++) map.set(c, String.fromCharCode(start + c - from));
    }
  }
  return map;
}

function fontsOf(page: PDFDict, doc: PDFDocument): Map<string, CMap | null> {
  const fonts = new Map<string, CMap | null>();
  const resources = page.lookup(PDFName.of("Resources"));
  const dict = resources instanceof PDFDict ? resources.lookup(PDFName.of("Font")) : undefined;
  if (!(dict instanceof PDFDict)) return fonts;
  for (const [name, ref] of dict.entries()) {
    const font = doc.context.lookup(ref);
    const cmap = font instanceof PDFDict ? bytesOf(font.get(PDFName.of("ToUnicode")), doc) : "";
    fonts.set(name.asString(), cmap ? parseCMap(cmap) : null);
  }
  return fonts;
}

function decodeHex(hex: string, cmap: CMap | null): string {
  if (!cmap) return Buffer.from(hex, "hex").toString("latin1");
  return (hex.match(/.{4}/g) ?? []).map((h) => cmap.get(parseInt(h, 16)) ?? "").join("");
}

function contentOf(page: PDFDict, doc: PDFDocument): string {
  const contents = page.lookup(PDFName.of("Contents"));
  if (contents instanceof PDFArray) return contents.asArray().map((c) => bytesOf(c, doc)).join("\n");
  return bytesOf(contents, doc);
}

/** Все строки текста всех страниц по порядку. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const lines: string[] = [];
  for (const page of doc.getPages()) {
    const fonts = fontsOf(page.node, doc);
    let font: CMap | null = null;
    // Операторы по порядку: смена шрифта (Tf) и вывод строк (Tj, TJ).
    for (const m of contentOf(page.node, doc).matchAll(/(\/[^\s/]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj|\[([^\]]*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (m[1]) font = fonts.get(m[1]) ?? null;
      else if (m[2] !== undefined) lines.push(decodeHex(m[2], font));
      else if (m[3] !== undefined) lines.push([...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) => decodeHex(h[1], font)).join(""));
      else if (m[4] !== undefined) lines.push(m[4].replace(/\\(.)/g, "$1"));
    }
  }
  return lines.join("\n");
}

/** Строка выписки «Остаток денег сделки в банке …: N ₸» — строка PDF может переноситься. */
export function bankBalance(text: string): string | null {
  return text.match(/Остаток денег сделки в банке[\s\S]{0,120}?:\s*([\d\s  ,]+₸)/)?.[1] ?? null;
}
