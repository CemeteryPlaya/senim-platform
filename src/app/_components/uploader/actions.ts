"use server";

import { z } from "zod";
import { FilePurpose } from "@/generated/prisma/enums";
import { createUpload, discardUpload, finalizeUpload } from "@/modules/files";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Через Server Action идут только метаданные и токены; байты — напрямую в хранилище (лимит Vercel 4,5 МБ).

export const createUploadAction = action(
  "files.createUpload",
  z.object({
    purpose: z.enum(FilePurpose),
    contentType: z.string().min(1).max(100),
    size: z.number().int().positive(),
  }),
  async (input) => {
    const user = await requireUser();
    return createUpload(user, input);
  },
);

export const finalizeUploadAction = action("files.finalizeUpload", z.object({ token: z.string().min(10).max(4000) }), async (input) => {
  const user = await requireUser();
  return finalizeUpload(user, input);
});

export const discardUploadAction = action("files.discardUpload", z.object({ fileId: z.string().min(1).max(100) }), async (input) => {
  const user = await requireUser();
  await discardUpload(user, input.fileId);
});
