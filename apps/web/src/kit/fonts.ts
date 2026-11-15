import { Inter } from "next/font/google";

// Inter — переменный шрифт с кириллицей (спека редизайна, раздел 4). next/font скачивает его при сборке
// и раздаёт с нашего домена; переменную --font-inter подхватывает токен --font-sans (tokens.css).
// Начертания в интерфейсе — только 400, 500, 600 (шкала --font-weight-* в tokens.css).
// Ось оптического размера opsz (14–32, пересмотр вида — разбор 3.3): крупные заголовки рисуются начертанием Display —
// уже очко, плотнее, как у SF. Включает её font-optical-sizing: auto (app.css): браузер берёт opsz по кеглю.
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
  axes: ["opsz"],
});

/** Классы для <html>: объявляют CSS-переменную шрифта. */
export const fontVariables: string = inter.variable;
