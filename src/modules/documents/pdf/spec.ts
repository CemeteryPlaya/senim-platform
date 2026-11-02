import type { PdfImage } from "../templates/types";

/**
 * Описание PDF-документа как данных: шаблон (оферта, акт, выписка) собирает блоки,
 * рендер (render.ts) раскладывает их по страницам. Шаблон не знает про pdf-lib,
 * поэтому текст документа проверяется обычными тестами без разбора PDF.
 */
export type TableColumn = { header: string; /** Доля ширины строки, сумма по колонкам = 1. */ width: number; align?: "left" | "right" };

export type Block =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean }
  /** Текст в рамке крупным полужирным — пометки, которые нельзя не заметить. */
  | { kind: "notice"; text: string }
  | { kind: "table"; columns: TableColumn[]; rows: string[][] }
  /** Фото в две колонки; image = null — файл недоступен, вместо фото рамка с подписью. */
  | { kind: "photos"; items: { image: PdfImage | null; caption: string }[] }
  /** Картинка подписи с подписью под ней (лист подписей). */
  | { kind: "image"; image: PdfImage; caption: string; maxHeight: number }
  | { kind: "signatures"; parties: { role: string; name: string; caption: string }[] };

export type PdfSpec = {
  /** Заголовок в свойствах PDF. */
  title: string;
  /** Дата формирования: попадает в текст и в свойства PDF; одинаковые данные — одинаковые байты. */
  issuedAt: Date;
  /** Колонтитул внизу каждой страницы (к нему добавляется «стр. X из Y»). */
  footer: string;
  blocks: Block[];
};

/** Весь видимый текст документа одной строкой — для тестов и поиска запрещённых слов. */
export function plainText(spec: PdfSpec): string {
  const parts: string[] = [spec.title, spec.footer];
  for (const b of spec.blocks) parts.push(...blockText(b));
  return parts.join("\n");
}

function blockText(b: Block): string[] {
  switch (b.kind) {
    case "table":
      return [...b.columns.map((c) => c.header), ...b.rows.flat()];
    case "signatures":
      return b.parties.flatMap((p) => [p.role, p.name, p.caption]);
    case "photos":
      return b.items.map((i) => i.caption);
    case "image":
      return [b.caption];
    default:
      return [b.text];
  }
}
