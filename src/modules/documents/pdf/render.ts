import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, PdfSpec, TableColumn } from "./spec";

/*
 * Шрифт — Tinos (Regular, Bold) под SIL Open Font License 1.1, лицензия — fonts/OFL-Tinos.txt,
 * источник — github.com/googlefonts/tinos. Есть кириллица, все казахские буквы и знак ₸.
 *
 * Почему не Times New Roman. Владелец просил Times New Roman 14 pt, как в правилах оформления документов РК.
 * Times New Roman принадлежит Monotype и поставляется с Windows: его лицензия не разрешает класть файл
 * в репозиторий и раздавать с сервера. Tinos метрически совместим с Times New Roman — ширина каждого
 * символа та же, поэтому переносы строк и число страниц совпадают, а на вид шрифты почти не отличаются.
 *
 * Как заменить на лицензионный Times New Roman (нужна лицензия Monotype на встраивание в PDF):
 * положить times.ttf и timesbd.ttf в fonts/ и поменять два имени файла в FONT_FILES ниже.
 * Вёрстка не изменится: метрики одинаковые. На Vercel папка fonts включена в трассировку
 * (outputFileTracingIncludes в next.config.ts).
 */
const FONT_FILES = { regular: "Tinos-Regular.ttf", bold: "Tinos-Bold.ttf" } as const;
const FONT_DIR = path.join(process.cwd(), "src", "modules", "documents", "fonts");

/** Имя шрифта в PDF — имя файла без расширения: фиксированное, чтобы одинаковый spec давал одинаковые байты. */
const fontName = (file: string) => path.basename(file, path.extname(file));

let fontBytes: Promise<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
function loadFonts() {
  fontBytes ??= Promise.all([readFile(path.join(FONT_DIR, FONT_FILES.regular)), readFile(path.join(FONT_DIR, FONT_FILES.bold))]).then(
    ([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }),
  );
  return fontBytes;
}

const MM = 72 / 25.4;
const PAGE = { width: 595.28, height: 841.89 }; // A4
/** Поля по правилам оформления документов: левое 30 мм (под подшивку), правое 15 мм, верхнее и нижнее 20 мм. */
const MARGIN = { left: 30 * MM, right: 15 * MM, top: 20 * MM, bottom: 20 * MM };
const RIGHT_EDGE = PAGE.width - MARGIN.right;
const CONTENT_WIDTH = RIGHT_EDGE - MARGIN.left;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.35, 0.35, 0.4);
/** Основной текст и заголовки — 14 pt (заголовки полужирные); подзаголовок, таблица, подписи и колонтитул — 12 pt, не мельче. */
const SIZE = { title: 14, heading: 14, body: 14, subtitle: 12, table: 12, caption: 12, footer: 12 } as const;
/*
 * Межстрочный интервал — 1,15 кегля. Это «одинарный» интервал Word для Times New Roman
 * (ascent + descent + lineGap шрифта = 1,15 em), которого требуют правила оформления документов,
 * поэтому PDF выглядит как привычный договор из Word. При кегле 14 строки и так крупные;
 * 1,5 растянул бы договор на лишние страницы. Читаемость добавляет отбивка 6 pt между абзацами.
 */
const LEADING = 1.15;
const PARAGRAPH_GAP = 6;
const CELL_PAD = 5;
const SIGNATURE_CAPTION = "Подпись: ЭЦП НУЦ РК (в электронной форме)";
/** Допуск сравнения координат в pt (погрешность плавающей точки). */
const EPS = 0.01;

type Fonts = { regular: PDFFont; bold: PDFFont };
type TextStyle = { font: PDFFont; size: number; color?: Color };

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

/**
 * Единственное место, где рисуется текст. Строка за полями — ошибка вёрстки: лучше не выпустить
 * документ, чем выпустить договор с обрезанным текстом. Сам текст в ошибку не попадает (в нём ИИН и ФИО).
 */
function put(page: PDFPage, text: string, x: number, baseline: number, style: TextStyle) {
  const right = x + style.font.widthOfTextAtSize(text, style.size);
  if (x < MARGIN.left - EPS || right > RIGHT_EDGE + EPS) {
    throw new Error(`PDF: строка выходит за поля (x=${x.toFixed(1)}, правый край=${right.toFixed(1)}, кегль=${style.size})`);
  }
  page.drawText(text, { x, y: baseline, size: style.size, font: style.font, color: style.color ?? INK });
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

  lines(lines: string[], style: TextStyle & { align?: "left" | "center" }) {
    const step = style.size * LEADING;
    for (const line of lines) {
      this.ensure(step);
      const width = style.font.widthOfTextAtSize(line, style.size);
      const x = style.align === "center" ? MARGIN.left + (CONTENT_WIDTH - width) / 2 : MARGIN.left;
      put(this.page, line, x, this.y - style.size, style);
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
    let x = MARGIN.left;
    wrapped.forEach((lines, i) => {
      c.page.drawRectangle({ x, y: c.y - height, width: widths[i], height, borderColor: MUTED, borderWidth: 0.5 });
      lines.forEach((line, n) => {
        const textWidth = font.widthOfTextAtSize(line, size);
        const tx = columns[i].align === "right" ? x + widths[i] - CELL_PAD - textWidth : x + CELL_PAD;
        put(c.page, line, tx, c.y - CELL_PAD - size - n * step + 1, { font, size });
      });
      x += widths[i];
    });
    c.y -= height;
  };

  drawRow(columns.map((col) => col.header), bold);
  for (const row of rows) drawRow(row, regular);
  c.y -= PARAGRAPH_GAP;
}

function drawSignatures(c: Cursor, parties: { role: string; name: string }[]) {
  const { regular, bold } = c.fonts;
  const colWidth = CONTENT_WIDTH / parties.length;
  const textWidth = colWidth - 12;
  const bodyStep = SIZE.body * LEADING;
  const captionStep = SIZE.caption * LEADING;
  const blocks = parties.map((p) => ({
    role: wrapText(p.role, bold, SIZE.body, textWidth),
    name: wrapText(p.name, regular, SIZE.body, textWidth),
    caption: wrapText(SIGNATURE_CAPTION, regular, SIZE.caption, textWidth),
  }));
  const gap = bodyStep * 0.5;
  const height = Math.max(...blocks.map((b) => (b.role.length + b.name.length) * bodyStep + gap + b.caption.length * captionStep));
  c.ensure(height);
  blocks.forEach((b, i) => {
    const x = MARGIN.left + i * colWidth;
    let top = c.y;
    const column = (lines: string[], style: TextStyle) => {
      for (const line of lines) {
        put(c.page, line, x, top - style.size, style);
        top -= style.size * LEADING;
      }
    };
    column(b.role, { font: bold, size: SIZE.body });
    column(b.name, { font: regular, size: SIZE.body });
    top -= gap;
    column(b.caption, { font: regular, size: SIZE.caption, color: MUTED });
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
      c.y -= PARAGRAPH_GAP;
      c.ensure(SIZE.heading * LEADING + SIZE.body * LEADING * 2); // заголовок не остаётся один внизу страницы
      c.lines(wrapText(block.text, bold, SIZE.heading, CONTENT_WIDTH), { font: bold, size: SIZE.heading });
      return;
    case "paragraph": {
      const font = block.bold ? bold : regular;
      c.lines(wrapText(block.text, font, SIZE.body, CONTENT_WIDTH), { font, size: SIZE.body });
      c.y -= PARAGRAPH_GAP;
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

/** Колонтитул в нижнем поле: текст слева, «стр. X из Y» справа на первой строке. */
function drawFooter(page: PDFPage, font: PDFFont, footer: string, pageLabel: string) {
  const style = { font, size: SIZE.footer, color: MUTED };
  const labelWidth = font.widthOfTextAtSize(pageLabel, SIZE.footer);
  const firstBaseline = MARGIN.bottom - 6 - SIZE.footer;
  wrapText(footer, font, SIZE.footer, CONTENT_WIDTH - labelWidth - 12).forEach((line, n) => {
    put(page, line, MARGIN.left, firstBaseline - n * SIZE.footer * LEADING, style);
  });
  put(page, pageLabel, RIGHT_EDGE - labelWidth, firstBaseline, style);
}

/**
 * PDF из описания. Детерминирован: одинаковый spec — одинаковые байты
 * (даты в свойствах = issuedAt, имена шрифтов фиксированы), поэтому хэш стабилен.
 */
export async function renderPdf(spec: PdfSpec): Promise<Uint8Array> {
  const bytes = await loadFonts();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  // Шрифт встраивается целиком: подмножество pdf-lib теряет составные глифы, а в Tinos кириллица
  // собрана из латинских (А = A, О = O) — буквы пропадали со страницы. Цена — ≈ 0,6 МБ на документ.
  const fonts: Fonts = {
    regular: await doc.embedFont(bytes.regular, { subset: false, customName: fontName(FONT_FILES.regular) }),
    bold: await doc.embedFont(bytes.bold, { subset: false, customName: fontName(FONT_FILES.bold) }),
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
  pages.forEach((page, i) => drawFooter(page, fonts.regular, spec.footer, `стр. ${i + 1} из ${pages.length}`));

  return doc.save({ useObjectStreams: false });
}
