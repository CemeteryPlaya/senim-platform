import { Inter } from "next/font/google";

// Inter — переменный шрифт с кириллицей (спека редизайна, раздел 4). next/font скачивает его при сборке
// и раздаёт с нашего домена; переменную --font-inter подхватывает токен --font-sans (tokens.css).
// Начертания в интерфейсе — только 400, 500, 600 (шкала --font-weight-* в tokens.css).
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

/** Классы для <html>: объявляют CSS-переменную шрифта. */
export const fontVariables: string = inter.variable;
