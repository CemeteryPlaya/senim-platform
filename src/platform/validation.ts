import { z } from "zod";
import { ru } from "@/i18n/ru";
import { fail } from "./errors";

/**
 * Разбор входа сервиса (его вызывают и экраны через action(), и другие модули, и задачи):
 * ошибка — VALIDATION с первым понятным сообщением и ошибками по полям (details.fieldErrors).
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const flat = z.flattenError(parsed.error);
  const first = flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? ru.common.errors.invalid;
  return fail.validation(String(first), { fieldErrors: flat.fieldErrors });
}
