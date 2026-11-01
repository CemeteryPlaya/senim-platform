// Конфигурация vitest для Stryker: только проект unit из основного vitest.config.mts.
// Мутанты чистой логики убиваются unit-тестами; интеграционным тестам под Stryker
// нужна своя база на каждого воркера (см. docs/quality/README.md).
import { defineConfig } from "vitest/config";
import base from "../../vitest.config.mts";

const unit = (base.test?.projects ?? []).filter((p) => typeof p === "object" && p.test?.name === "unit");

export default defineConfig({ ...base, test: { ...base.test, projects: unit } });
