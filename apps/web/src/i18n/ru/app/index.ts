// Тексты нового интерфейса (v2). Каждая часть — свой файл в этой папке.
import { buyer } from "./buyer";
import { chat } from "./chat";
import { deal } from "./deal";
import { guest } from "./guest";
import { kit } from "./kit";
import { login } from "./login";
import { master } from "./master";
import { masterRequests } from "./master-requests";
import { offer } from "./offer";
import { onboarding } from "./onboarding";
import { profile } from "./profile";
import { requestCard } from "./request-card";
import { requests } from "./requests";
import { shell } from "./shell";

export const app = {
  buyer,
  chat,
  deal,
  guest,
  kit,
  login,
  master,
  masterRequests,
  offer,
  onboarding,
  profile,
  requestCard,
  requests,
  shell,
} as const;
