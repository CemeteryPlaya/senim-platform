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

const nextConfig: NextConfig = {
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
