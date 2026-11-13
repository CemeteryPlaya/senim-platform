// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { buyer } from "./buyer";
import { guest } from "./guest";
import { kit } from "./kit";
import { login } from "./login";
import { offer } from "./offer";
import { onboarding } from "./onboarding";
import { requestCard } from "./request-card";
import { requests } from "./requests";
import { shell } from "./shell";

export const app = {
  buyer,
  guest,
  kit,
  login,
  offer,
  onboarding,
  requestCard,
  requests,
  shell,
} as const;
