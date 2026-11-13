"use server";

import { z } from "zod";
import { FilePurpose } from "@/generated/prisma/enums";
import { createUpload, discardUpload, finalizeUpload } from "@/modules/files";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Загрузка фото в новом интерфейсе: те же функции модуля files, что у загрузчика v1. Через Server Action идут только
// метаданные и токены; байты — напрямую в хранилище по подписанной цели (лимит тела запроса Vercel 4,5 МБ). Права,
// типы (в том числе HEIC), размер и число файлов по назначению проверяет модуль files.

/** Цель загрузки: подписанный адрес хранилища и токен для finalize. */
export const createUploadAction = action(
  "app.upload.create",
  z.strictObject({
    purpose: z.enum(FilePurpose),
    contentType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  }),
  async (input) => {
    const user = await requireUser();
    return createUpload(user, input);
  },
);

/** Файл загружен: модуль проверяет байты и сохраняет запись; ответ — id файла и адрес превью. */
export const finalizeUploadAction = action("app.upload.finalize", z.strictObject({ token: z.string().min(10).max(4000) }), async (input) => {
  const user = await requireUser();
  return finalizeUpload(user, input);
});

/** Убрать свой ещё не прикреплённый файл (прикреплённые открепляет модуль-владелец при сохранении формы). */
export const discardUploadAction = action("app.upload.discard", z.strictObject({ fileId: z.string().min(1).max(100) }), async (input) => {
  const user = await requireUser();
  await discardUpload(user, input.fileId);
});
