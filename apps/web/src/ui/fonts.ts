import { Onest } from "next/font/google";

// Шрифт с кириллицей. next/font скачивает его при сборке и раздаёт с нашего домена.
// Переменную подхватывает токен --font-sans (tokens.css).

/**
 * Onest — ближайший к макетам гротеск с хорошей кириллицей: жирные заголовки (800),
 * спокойный текст (400–500). Вариативный — один файл на все начертания.
 */
const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});

/** Классы для <html>: объявляют CSS-переменную шрифта. */
export const fontVariables = onest.variable;
