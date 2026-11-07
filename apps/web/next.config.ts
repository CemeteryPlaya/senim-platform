import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// В git worktree агентов node_modules — ссылка (junction) на общую папку
// основного дерева. Turbopack не выходит за корень проекта, поэтому цель
// ссылки должна быть внутри корня: корнем становится общий родитель проекта и ссылки.
// В обычной установке ничего не меняется.
function sharedRoot(): string | null {
  const local = path.join(process.cwd(), "node_modules");
  try {
    if (!lstatSync(local).isSymbolicLink()) return null;
    const target = path.dirname(realpathSync(local));
    const project = process.cwd();
    let root = target;
    while (path.relative(root, project).startsWith("..")) root = path.dirname(root);
    return root;
  } catch {
    return null;
  }
}

const root = sharedRoot();

// Заголовки безопасности для всех ответов. CSP — только frame-ancestors (защита от встраивания
// в чужой сайт): script-src и прочее не задаём, чтобы не сломать встроенные скрипты Next.
// Камера разрешена своему сайту — фото замеров и этапов снимают с телефона.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
  // HSTS — только в production: локально сайт работает по http.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Своя папка сборки для e2e (NEXT_DIST_DIR=.next-e2e в playwright.config.ts): блокировка `next dev`
  // берётся на папку сборки, и без этого e2e-сервер не стартует рядом с `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Заголовок из next.config побеждает заголовок обработчика, а /api/files/* отдаёт загруженные
      // файлы со своим, более строгим CSP (default-src 'none'; sandbox) — его не перетираем.
      { source: "/((?!api/files/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      // Сервис-воркер (по руководству Next по PWA): браузер всегда сверяет свежую версию, а сам воркер
      // ходит только на свой домен. Правило последнее — его CSP заменяет общий для этого пути.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
  // Приложение почти полностью динамическое (роль из cookie, данные из БД),
  // поэтому используем классическую модель рендеринга без Cache Components.
  cacheComponents: false,
  partialPrefetching: false,
  // Шрифты PDF читаются с диска во время запроса — без этого их нет в сборке Vercel.
  outputFileTracingIncludes: {
    "/*": ["src/modules/documents/fonts/*.ttf"],
  },
  experimental: {
    serverActions: {
      // фото этапов приходят как сжатые data URL
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    ...(root ? { root } : {}),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
