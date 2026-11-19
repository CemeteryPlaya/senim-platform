"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { setRequestFileHidden } from "@/modules/requests";
import { action } from "@/platform/action";

/**
 * «Скрыть» (`hidden: "1"`) и «Вернуть» (`"0"`) файл дизайн-проекта заявки. Права — оператор (`requireUser("OPERATOR")`
 * первой строкой, дальше проверяет и сам модуль); повтор и двойной клик второго эффекта и второй записи аудита не дают
 * (условный `updateMany` в requests). После — страница «Файлы заявки» перерисовывается.
 */
export const setRequestFileHiddenAction = action(
  "app.operator.requestFiles.setHidden",
  z.strictObject({ fileId: z.string().min(1).max(100), hidden: z.enum(["1", "0"]) }),
  async ({ fileId, hidden }) => {
    const user = await requireUser("OPERATOR");
    const result = await setRequestFileHidden(user, { fileId, hidden: hidden === "1" });
    revalidatePath("/(app)/v2/operator/requests/[number]", "page");
    return result;
  },
);
