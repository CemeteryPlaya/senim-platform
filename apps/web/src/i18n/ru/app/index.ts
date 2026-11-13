// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { buyer } from "./buyer";
import { guest } from "./guest";
import { kit } from "./kit";
import { login } from "./login";
import { onboarding } from "./onboarding";
import { requests } from "./requests";
import { shell } from "./shell";

export const app = {
  buyer,
  guest,
  kit,
  login,
  onboarding,
  requests,
  shell,
} as const;
