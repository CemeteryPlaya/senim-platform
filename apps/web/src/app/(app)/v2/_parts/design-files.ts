import type { FileView } from "@/modules/files/client";

// Свой дизайн-проект покупателя на экранах v2 (чистая логика): карточка заявки покупателя, входящая заявка мастера и
// карточка сделки. Файлы приходят от модулей уже с подписанными ссылками (`fileViews`); мастеру и сделке модули скрытых
// файлов не отдают вовсе, покупателю-загрузчику — с пометкой `hidden`.

/** Файл проекта: вид (фото или PDF), ссылка, номер; `hidden` — скрыт оператором (есть только у покупателя). */
export type DesignFileInput = FileView & { hidden?: boolean };

/** Подписи из словаря экрана: PDF и фото по номеру; пометка скрытого — только у покупателя. */
export type DesignTexts = { pdf: (n: number) => string; photo: (n: number) => string; hidden?: string };

export type DesignView = {
  /** Фото, которые видят мастера, — галереей (по нажатию на весь экран). */
  gallery: { src: string; alt: string }[];
  /** PDF и скрытые оператором файлы — строками-ссылками (в новой вкладке); у скрытого — пометка. */
  rows: { id: string; href: string; label: string; hidden: string | null }[];
};

/** Вид раздела «Дизайн-проект»; файлов нет — раздела нет (`null`). */
export function designView(files: readonly DesignFileInput[], texts: DesignTexts): DesignView | null {
  if (files.length === 0) return null;
  const gallery: DesignView["gallery"] = [];
  const rows: DesignView["rows"] = [];
  for (const f of files) {
    const label = f.kind === "pdf" ? texts.pdf(f.n) : texts.photo(f.n);
    if (f.kind === "image" && !f.hidden) gallery.push({ src: f.src, alt: label });
    else rows.push({ id: f.id, href: f.src, label, hidden: f.hidden ? (texts.hidden ?? null) : null });
  }
  return { gallery, rows };
}
