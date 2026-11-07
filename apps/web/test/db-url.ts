import "dotenv/config";

/** Отдельная база для тестов (см. .env.example). Рабочую базу тесты никогда не трогают. */
function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Задайте TEST_DATABASE_URL (пример — в .env.example)");
  if (!/test/i.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL должен указывать на базу с «test» в имени");
  return url;
}

export const TEST_DATABASE_URL = testDatabaseUrl();
