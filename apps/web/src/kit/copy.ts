/**
 * Копирование текста в буфер. Сначала Clipboard API (нужен безопасный контекст и жест человека), запасной путь —
 * выделение скрытого поля и `execCommand("copy")` (старые браузеры, встроенные окна). `false` — не вышло.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Нет разрешения или не безопасный контекст — пробуем запасной путь.
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  // Вне экрана, но не display:none (иначе выделение не работает); 16 px — iOS не приближает.
  field.style.cssText = "position:fixed;top:0;left:-9999px;font-size:16px;opacity:0";
  document.body.appendChild(field);
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus();
  }
}
