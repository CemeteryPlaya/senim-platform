import { notFound } from "next/navigation";

/**
 * Любой адрес, которого нет ни в v1, ни в v2. Без общего корневого layout Next показывал бы для него встроенную
 * 404 без оболочки и стилей; здесь notFound() отдаёт 404 из (legacy)/not-found.tsx внутри layout v1 — как раньше.
 */
export default function Missing(): never {
  notFound();
}
