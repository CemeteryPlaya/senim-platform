// Генератор метаданных моделей для админки: npm run admin:schema. Читает prisma/schema.prisma и пишет
// src/modules/admin/schema.gen.ts (в git). Запускать после каждой правки схемы — иначе падает тест schema-sync.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Прямой импорт чистой функции, а не index.ts: index модуля тянет базу и server-only, генератору они не нужны.
// eslint-disable-next-line no-restricted-imports
import { parseEnums, parseSchema } from "@/modules/admin/schema-parse";
import { logger } from "@/platform/logger";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const models = parseSchema(source);
const enums = parseEnums(source);

// Одно поле и одно перечисление — одна строка: дифф правки схемы читается построчно.
const modelText = (m: (typeof models)[number]) =>
  `  {\n    name: ${JSON.stringify(m.name)},\n    idField: ${JSON.stringify(m.idField)},\n    fields: [\n${m.fields
    .map((f) => `      ${JSON.stringify(f)},`)
    .join("\n")}\n    ],\n  },`;

const out = `// Сгенерировано scripts/admin-schema.ts из prisma/schema.prisma — руками не править: npm run admin:schema.
import type { AdminModel } from "./schema-parse";

export const ADMIN_MODELS: readonly AdminModel[] = [
${models.map(modelText).join("\n")}
];

export const ENUMS: Readonly<Record<string, readonly string[]>> = {
${Object.entries(enums)
  .map(([name, values]) => `  ${name}: ${JSON.stringify(values)},`)
  .join("\n")}
};
`;

const target = path.join(root, "src/modules/admin/schema.gen.ts");
writeFileSync(target, out, "utf8");
logger.info("admin.schema.generated", { models: models.length, enums: Object.keys(enums).length });
