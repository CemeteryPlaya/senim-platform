import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Тексты, которые видит пользователь (сообщения ошибок, валидации, ответы маршрутов), — только из ru.
 * Ловим самые частые места: fail.*("…"), «error: "…"», «reason: "…"» и сообщения zod .min/.max(…, "…").
 * Комментарии, журнал (logger) и демо-данные сюда не попадают.
 */
const USER_TEXT = /(fail\.[a-zA-Z]+\(|\berror: |\breason: |\?\? |\.(?:min|max)\([^,()]+, )"[^"]*[А-Яа-яЁё]/;

/** В platform пользовательских текстов нет вовсе: любая русская строка вне комментария — мимо ru. */
const PLATFORM_TEXT = /^(?!\s*(?:\/\/|\*|\/\*)).*["`][^"`]*[А-Яа-яЁё]/;
/** Тексты не для пользователя: проверка env, внутренние ошибки, метка скрытых секретов в журнале. */
const PLATFORM_NOT_USER_FACING = ["src/platform/env.ts", "src/platform/crypto.ts", "src/platform/kz-id.ts", "src/platform/logger.ts", "src/platform/jobs/"];

async function sources(dir: string): Promise<string[]> {
  const root = path.join(process.cwd(), dir);
  const files = await readdir(root, { recursive: true });
  return files.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => path.join(dir, f));
}

/** Тест читает весь src/modules и src/app: на полном прогоне под нагрузкой 5 с по умолчанию не хватает. */
const SCAN_TIMEOUT_MS = 30_000;

describe("тексты интерфейса — только из ru", { timeout: SCAN_TIMEOUT_MS }, () => {
  it("в модулях и маршрутах нет строк для пользователя мимо ru", async () => {
    const files = [...(await sources("src/modules")), ...(await sources("src/app"))];
    const found: string[] = [];
    for (const file of files) {
      const lines = (await readFile(path.join(process.cwd(), file), "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (USER_TEXT.test(line)) found.push(`${file.replace(/\\/g, "/")}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("в platform нет русских строк мимо ru (кроме текстов не для пользователя)", async () => {
    const files = (await sources("src/platform"))
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !PLATFORM_NOT_USER_FACING.some((allowed) => f.startsWith(allowed)));
    const found: string[] = [];
    for (const file of files) {
      const lines = (await readFile(path.join(process.cwd(), file), "utf8")).split("\n");
      lines.forEach((line, i) => {
        // Комментарий в конце строки («| "CONFLICT" // состояние изменилось») — не текст.
        if (PLATFORM_TEXT.test(line.replace(/\s\/\/[^\n]*$/, ""))) found.push(`${file}:${i + 1}`);
      });
    }
    expect(found).toEqual([]);
  });
});
