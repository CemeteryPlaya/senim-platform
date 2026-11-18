import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { env } from "@/platform/env";
import { TEST_STORAGE_ROOT_ENV } from "../../../test/storage-dir";
import { saveFile } from "./index";

/** Интеграционные тесты пишут файлы в папку прогона (test/global-setup.ts), а не в ./storage dev и стенда. */
describe("хранилище интеграционных тестов", () => {
  it("локальное хранилище по умолчанию — внутри папки прогона во временном каталоге", async () => {
    const root = process.env[TEST_STORAGE_ROOT_ENV] ?? "";
    expect(path.basename(root)).toMatch(/^senim-test-storage-/);
    const dir = path.resolve(env().STORAGE_LOCAL_DIR);
    expect(dir.startsWith(path.resolve(root) + path.sep)).toBe(true);

    const file = await saveFile({ purpose: "DOCUMENT", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n") });
    expect(file.provider).toBe("local");
    expect((await stat(path.join(dir, file.storageKey))).isFile()).toBe(true);
  });
});
