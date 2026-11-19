import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $Enums, Prisma } from "@/generated/prisma/browser";
import { ADMIN_MODELS, ENUMS } from "./schema.gen";
import { parseEnums, parseSchema } from "./schema-parse";

// Устарел schema.gen.ts — обнови: npm run admin:schema.
const source = readFileSync(fileURLToPath(new URL("../../../prisma/schema.prisma", import.meta.url)), "utf8");

describe("schema.gen.ts совпадает с prisma/schema.prisma", () => {
  it("модели и поля", () => {
    expect(ADMIN_MODELS).toEqual(parseSchema(source));
  });

  it("перечисления", () => {
    expect(ENUMS).toEqual(parseEnums(source));
  });

  it("модели — ровно модели Prisma Client", () => {
    expect(new Set(ADMIN_MODELS.map((m) => m.name))).toEqual(new Set(Object.values(Prisma.ModelName)));
  });

  it("скалярные поля каждой модели (scalar и enum) — ровно <Model>ScalarFieldEnum Prisma Client, в том же порядке", () => {
    const namespace: Readonly<Record<string, unknown>> = Prisma;
    for (const model of ADMIN_MODELS) {
      const scalarEnum = namespace[`${model.name}ScalarFieldEnum`];
      expect(scalarEnum, model.name).toBeTypeOf("object");
      const expected = Object.values(scalarEnum as Readonly<Record<string, string>>);
      expect(model.fields.filter((f) => f.kind !== "object").map((f) => f.name), model.name).toEqual(expected);
    }
  });

  it("перечисления — ровно перечисления Prisma Client", () => {
    const client = Object.fromEntries(Object.entries($Enums).map(([name, values]) => [name, Object.values(values)]));
    expect(ENUMS).toEqual(client);
  });
});
