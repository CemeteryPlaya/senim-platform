// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { guest } from "./guest";
import { kit } from "./kit";
import { login } from "./login";
import { shell } from "./shell";

export const app = {
  guest,
  kit,
  login,
  shell,
} as const;
