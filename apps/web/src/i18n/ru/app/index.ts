// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { kit } from "./kit";
import { shell } from "./shell";

export const app = {
  kit,
  shell,
} as const;
