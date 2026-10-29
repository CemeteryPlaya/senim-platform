import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDatabase } from "../src/lib/seed-data";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

seedDatabase(db)
  .then(() => console.log("Демо-данные загружены"))
  .finally(() => db.$disconnect());
