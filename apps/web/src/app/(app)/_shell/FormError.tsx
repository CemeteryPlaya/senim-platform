import { Notice } from "@/kit";

/** Общая ошибка формы; `atField` — тот же текст уже стоит у поля, и второй раз он не нужен. */
export function FormError({ error, atField = false }: { error: string | null; atField?: boolean }) {
  if (!error || atField) return null;
  return (
    <Notice tone="danger" live>
      {error}
    </Notice>
  );
}
