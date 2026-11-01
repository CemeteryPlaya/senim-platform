// Мутационное тестирование: эквивалент инструмента `mutator` из SKILL.md.
// npm run quality:mutate                                  — чистая логика по умолчанию (список ниже)
// npm run quality:mutate -- --mutate src/modules/x/y.ts   — свой набор файлов
// Отчёты: reports/quality/mutation/ (html и json). Подробнее — docs/quality/README.md.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  // related: только тесты, которые импортируют мутируемые файлы (быстрее и не зависит от чужих красных тестов).
  vitest: { configFile: "scripts/quality/vitest.unit.config.mjs", related: true },
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: [
    // статусные машины и таблицы переходов
    "src/modules/deal-core/transitions.ts",
    "src/modules/deal-core/next-step.ts",
    "src/modules/deal-core/stage-plan.ts",
    "src/modules/requests/transitions.ts",
    // деньги
    "src/modules/deal-core/retry-policy.ts",
    "src/modules/payments/fees.ts",
    "src/modules/payments/escrow-status.ts",
    "src/modules/payments/reconcile-entries.ts",
    "src/modules/payments/webhook-signature.ts",
    "src/modules/payments/modes.ts",
    // маскирование контактов, ИИН/БИН, проверки ввода
    "src/modules/companies/mask.ts",
    "src/platform/kz-id.ts",
    "src/platform/validation.ts",
    // правила мебельной вертикали
    "src/verticals/furniture/segment.ts",
    "src/verticals/furniture/stage-templates.ts",
  ],
  ignorePatterns: ["reports", "coverage", "test-results", "playwright-report", ".next", "storage", "docs", "e2e", ".claude", ".agents", ".windsurf", ".playwright-mcp", ".remember", ".harness-worktrees", ".codebase-memory"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/quality/mutation/index.html" },
  jsonReporter: { fileName: "reports/quality/mutation/mutation.json" },
  tempDirName: ".stryker-tmp",
  // Песочница лежит внутри репозитория, node_modules находится подъёмом по каталогам.
  // Ссылку (junction) не создаём: её удаление на Windows уже стирало пакеты.
  symlinkNodeModules: false,
  cleanTempDir: "always",
  thresholds: { high: 90, low: 75, break: null },
  timeoutMS: 20000,
  concurrency: 4,
};

export default config;
