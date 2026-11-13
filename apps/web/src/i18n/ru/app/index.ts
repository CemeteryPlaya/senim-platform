// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { guest } from "./guest";
import { kit } from "./kit";
import { shell } from "./shell";

export const app = {
  guest,
  kit,
  shell,
} as const;
