import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { action } from "./action";
import { fail } from "./errors";

describe("action()", () => {
  const schema = z.object({ title: z.string().min(3), price: z.number() });

  it("ошибка разбора: общий текст из ru, у полей — русские сообщения zod", async () => {
    const run = action("test", schema, async () => "ok");
    const result = await run({ title: "Ш", price: "x" as unknown as number });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", error: ru.common.errors.invalid });
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["title", "price"]);
    expect(Object.values(result.fieldErrors ?? {}).flat().join(" ")).toMatch(/ожидалось/);
  });

  it("ошибка приложения — её текст; неожиданная — общий текст из ru без подробностей", async () => {
    expect(await action("test", schema, async () => fail.conflict())({ title: "Шкаф", price: 1 })).toEqual({
      ok: false,
      code: "CONFLICT",
      error: ru.common.errors.conflict,
    });
    const crash = await action("test", schema, async () => {
      throw new Error("db password leaked");
    })({ title: "Шкаф", price: 1 });
    expect(crash).toEqual({ ok: false, code: "INTERNAL", error: ru.common.errors.generic });
  });

  it("ошибки полей из сервиса доходят до формы; без них или не объектом — не передаются", async () => {
    const withFields = action("test", schema, async () => fail.validation("Проверьте поля", { fieldErrors: { title: ["Слишком коротко"] } }));
    expect(await withFields({ title: "Шкаф", price: 1 })).toEqual({
      ok: false,
      code: "VALIDATION",
      error: "Проверьте поля",
      fieldErrors: { title: ["Слишком коротко"] },
    });
    for (const details of [undefined, { other: 1 }, { fieldErrors: "строка" }, { fieldErrors: null }]) {
      const result = await action("test", schema, async () => fail.validation("Нет", details))({ title: "Шкаф", price: 1 });
      expect(result).toEqual({ ok: false, code: "VALIDATION", error: "Нет" });
    }
  });
});
