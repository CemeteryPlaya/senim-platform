import { to } from "../../_shell/paths";

/** Роль, с которой гость идёт на вход: экран входа читает параметр `role`. */
export type LoginRole = "client" | "executor";

/** Адрес входа с ролью: `/v2/login?role=client`. Параметр собирается здесь, а не строкой в разметке. */
export function loginHref(role: LoginRole): string {
  return `${to("/login")}?${new URLSearchParams({ role }).toString()}`;
}
