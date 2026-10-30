import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, PdfSpec, TableColumn } from "./spec";

/*
 * Шрифт — Lora (Regular, Bold) под SIL Open Font License 1.1, лицензия — fonts/OFL.txt.
 * Источник: Google Fonts (github.com/cyrealtype/Lora-Cyrillic), копия из набора OFL-шрифтов на машине разработчика,
 * потому что сеть в окружении агента закрыта. Есть кириллица, казахские буквы и знак ₸.
 * На Vercel папку fonts нужно включить в трассировку (outputFileTracingIncludes) — см. отчёт интегратору.
 */
const FONT_DIR = path.join(process.cwd(), "src", "modules", "documents", "fonts");

let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
function loadFonts() {
  fontBytes ??= Promise.all([readFile(path.join(FONT_DIR, "Lora-Regular.ttf")), readFile(path.join(FONT_DIR, "Lora-Bold.ttf"))]).then(
    ([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }),
  );
  return fontBytes;
}

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = { x: 56, top: 56, bottom: 72 };
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN.x;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.35, 0.35, 0.4);
const SIZE = { title: 15, subtitle: 10.5, heading: 12, body: 10.5, table: 9.5, footer: 8 };
const LEADING = 1.4;
const CELL_PAD = 4;

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Разбивает текст на строки по ширине. Неразрывные пробелы (суммы) не разрываются. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      // Слово длиннее строки режем посимвольно.
      while (font.widthOfTextAtSize(line, size) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Курсор по страницам: сам добавляет новую страницу, когда место кончилось. */
class Cursor {
  page: PDFPage;
  y: number;
  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN.top;
  }

  ensure(height: number) {
    if (this.y - height >= MARGIN.bottom) return;
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN.top;
  }

  lines(lines: string[], opts: { font: PDFFont; size: number; align?: "left" | "center"; color?: ReturnType<typeof rgb> }) {
    const step = opts.size * LEADING;
    for (const line of lines) {
      this.ensure(step);
      const width = opts.font.widthOfTextAtSize(line, opts.size);
      const x = opts.align === "center" ? (PAGE.width - width) / 2 : MARGIN.x;
      this.page.drawText(line, { x, y: this.y - opts.size, size: opts.size, font: opts.font, color: opts.color ?? INK });
      this.y -= step;
    }
  }
}

function drawTable(c: Cursor, columns: TableColumn[], rows: string[][]) {
  const { regular, bold } = c.fonts;
  const size = SIZE.table;
  const step = size * LEADING;
  const widths = columns.map((col) => col.width * CONTENT_WIDTH);

  const drawRow = (cells: string[], font: PDFFont) => {
    const wrapped = cells.map((cell, i) => wrapText(cell, font, size, widths[i] - 2 * CELL_PAD));
    const height = Math.max(...wrapped.map((l) => l.length)) * step + 2 * CELL_PAD;
    c.ensure(height);
    let x = MARGIN.x;
    wrapped.forEach((lines, i) => {
      c.page.drawRectangle({ x, y: c.y - height, width: widths[i], height, borderColor: MUTED, borderWidth: 0.5 });
      lines.forEach((line, n) => {
        const textWidth = font.widthOfTextAtSize(line, size);
        const tx = columns[i].align === "right" ? x + widths[i] - CELL_PAD - textWidth : x + CELL_PAD;
        c.page.drawText(line, { x: tx, y: c.y - CELL_PAD - size - n * step + 1, size, font, color: INK });
      });
      x += widths[i];
    });
    c.y -= height;
  };

  drawRow(columns.map((col) => col.header), bold);
  for (const row of rows) drawRow(row, regular);
  c.y -= SIZE.body * 0.6;
}

function drawSignatures(c: Cursor, parties: { role: string; name: string }[]) {
  const { regular, bold } = c.fonts;
  const colWidth = CONTENT_WIDTH / parties.length;
  const blocks = parties.map((p) => ({
    role: p.role,
    name: wrapText(p.name, regular, SIZE.body, colWidth - 12),
  }));
  const step = SIZE.body * LEADING;
  const height = (Math.max(...blocks.map((b) => b.name.length)) + 3) * step;
  c.ensure(height);
  blocks.forEach((b, i) => {
    const x = MARGIN.x + i * colWidth;
    let y = c.y - SIZE.body;
    c.page.drawText(b.role, { x, y, size: SIZE.body, font: bold, color: INK });
    for (const line of b.name) {
      y -= step;
      c.page.drawText(line, { x, y, size: SIZE.body, font: regular, color: INK });
    }
    y -= step * 1.5;
    c.page.drawText("Подпись: ЭЦП НУЦ РК (в электронной форме)", { x, y, size: SIZE.footer, font: regular, color: MUTED });
  });
  c.y -= height;
}

function drawBlock(c: Cursor, block: Block) {
  const { regular, bold } = c.fonts;
  switch (block.kind) {
    case "title":
      c.lines(wrapText(block.text, bold, SIZE.title, CONTENT_WIDTH), { font: bold, size: SIZE.title, align: "center" });
      return;
    case "subtitle":
      c.lines(wrapText(block.text, regular, SIZE.subtitle, CONTENT_WIDTH), { font: regular, size: SIZE.subtitle, align: "center", color: MUTED });
      c.y -= SIZE.body;
      return;
    case "heading":
      c.y -= SIZE.body * 0.5;
      c.ensure(SIZE.heading * LEADING + SIZE.body * LEADING * 2); // заголовок не остаётся один внизу страницы
      c.lines(wrapText(block.text, bold, SIZE.heading, CONTENT_WIDTH), { font: bold, size: SIZE.heading });
      return;
    case "paragraph": {
      const font = block.bold ? bold : regular;
      c.lines(wrapText(block.text, font, SIZE.body, CONTENT_WIDTH), { font, size: SIZE.body });
      c.y -= SIZE.body * 0.4;
      return;
    }
    case "table":
      drawTable(c, block.columns, block.rows);
      return;
    case "signatures":
      drawSignatures(c, block.parties);
      return;
  }
}

/**
 * PDF из описания. Детерминирован: одинаковый spec — одинаковые байты
 * (даты в свойствах = issuedAt, имена шрифтов фиксированы), поэтому хэш стабилен.
 */
export async function renderPdf(spec: PdfSpec): Promise<Uint8Array> {
  const bytes = await loadFonts();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(bytes.regular, { subset: true, customName: "Lora-Regular" }),
    bold: await doc.embedFont(bytes.bold, { subset: true, customName: "Lora-Bold" }),
  };
  doc.setTitle(spec.title);
  doc.setLanguage("ru-RU");
  doc.setProducer("Сенім");
  doc.setCreator("Сенім");
  doc.setCreationDate(spec.issuedAt);
  doc.setModificationDate(spec.issuedAt);

  const cursor = new Cursor(doc, fonts);
  for (const block of spec.blocks) drawBlock(cursor, block);

  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const pageLabel = `стр. ${i + 1} из ${pages.length}`;
    const footerLines = wrapText(spec.footer, fonts.regular, SIZE.footer, CONTENT_WIDTH - 80);
    footerLines.forEach((line, n) => {
      page.drawText(line, { x: MARGIN.x, y: 40 - n * SIZE.footer * LEADING, size: SIZE.footer, font: fonts.regular, color: MUTED });
    });
    const w = fonts.regular.widthOfTextAtSize(pageLabel, SIZE.footer);
    page.drawText(pageLabel, { x: PAGE.width - MARGIN.x - w, y: 40, size: SIZE.footer, font: fonts.regular, color: MUTED });
  });

  return doc.save({ useObjectStreams: false });
}
