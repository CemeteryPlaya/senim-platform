/**
 * Описание PDF-документа как данных: шаблон (договор, акт) собирает блоки,
 * рендер (render.ts) раскладывает их по страницам. Шаблон не знает про pdf-lib,
 * поэтому текст договора проверяется обычными тестами без разбора PDF.
 */
export type TableColumn = { header: string; /** Доля ширины строки, сумма по колонкам = 1. */ width: number; align?: "left" | "right" };

export type Block =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "table"; columns: TableColumn[]; rows: string[][] }
  | { kind: "signatures"; parties: { role: string; name: string }[] };

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
  for (const b of spec.blocks) {
    switch (b.kind) {
      case "table":
        parts.push(...b.columns.map((c) => c.header), ...b.rows.flat());
        break;
      case "signatures":
        parts.push(...b.parties.flatMap((p) => [p.role, p.name]));
        break;
      default:
        parts.push(b.text);
    }
  }
  return parts.join("\n");
}
