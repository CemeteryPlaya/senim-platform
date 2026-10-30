import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Тексты, которые видит пользователь (сообщения ошибок, валидации, ответы маршрутов), — только из ru.
 * Ловим самые частые места: fail.*("…"), «error: "…"», «reason: "…"» и сообщения zod .min/.max(…, "…").
 * Комментарии, журнал (logger) и демо-данные сюда не попадают.
 */
const USER_TEXT = /(fail\.[a-zA-Z]+\(|\berror: |\breason: |\.(?:min|max)\([^,()]+, )"[^"]*[А-Яа-яЁё]/;

async function sources(dir: string): Promise<string[]> {
  const root = path.join(process.cwd(), dir);
  const files = await readdir(root, { recursive: true });
  return files.filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => path.join(dir, f));
}

describe("тексты интерфейса — только из ru", () => {
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
});
