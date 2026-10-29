import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Приложение почти полностью динамическое (роль из cookie, данные из БД),
  // поэтому используем классическую модель рендеринга без Cache Components.
  cacheComponents: false,
  partialPrefetching: false,
  experimental: {
    serverActions: {
      // фото этапов приходят как сжатые data URL
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
