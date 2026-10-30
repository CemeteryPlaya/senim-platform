import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInput } from "./validation";

const schema = z.object({ title: z.string().min(3, "Название — от 3 символов"), price: z.number().positive("Цена больше нуля") });

describe("parseInput", () => {
  it("возвращает разобранный вход", () => {
    expect(parseInput(schema, { title: "Шкаф", price: 10 })).toEqual({ title: "Шкаф", price: 10 });
  });

  it("ошибка — VALIDATION с первым сообщением и ошибками по полям", () => {
    expect(() => parseInput(schema, { title: "Ш", price: -1 })).toThrow(
      expect.objectContaining({
        code: "VALIDATION",
        message: "Название — от 3 символов",
        details: { fieldErrors: { title: ["Название — от 3 символов"], price: ["Цена больше нуля"] } },
      }),
    );
  });
});
