import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Граница модуля: снаружи можно импортировать только index.ts модуля
// (`@/modules/<имя>`) и клиентскую точку входа `@/modules/<имя>/client`.
const moduleBoundary = {
  group: ["@/modules/*/*", "!@/modules/*/client", "**/modules/*/*", "!**/modules/*/client"],
  message: "Импорт из другого модуля — только через его index.ts (@/modules/<имя>). Внутри модуля — относительные пути.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-console": "error", // только logger из src/platform/logger.ts
      "no-restricted-imports": ["error", { patterns: [moduleBoundary] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
    },
  },
  {
    // Ядро сделки переносимо: ничего мебельного и никаких экранов.
    files: ["src/modules/deal-core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            moduleBoundary,
            { group: ["@/verticals/*", "**/verticals/*"], message: "deal-core не знает про вертикали: получает шаблоны как конфигурацию." },
            { group: ["@/app/*"], message: "Модуль не зависит от экранов." },
          ],
        },
      ],
    },
  },
  {
    // Модули и платформа не зависят от экранов.
    files: ["src/modules/**", "src/platform/**", "src/verticals/**"],
    ignores: ["src/modules/deal-core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [moduleBoundary, { group: ["@/app/*"], message: "Модуль не зависит от экранов." }] },
      ],
    },
  },
  {
    files: ["src/platform/logger.ts"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", ".remember/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**", ".agents/**", ".windsurf/**", ".claude/**", "playwright-report/**", "test-results/**", "coverage/**", ".playwright-mcp/**", ".harness-worktrees/**"]),
]);

export default eslintConfig;
