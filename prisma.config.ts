import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Сид использует серверные модули (documents): server-only подменяется хуком, как в npm run jobs.
    seed: "tsx --import ./scripts/server-only-hook.mjs prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
