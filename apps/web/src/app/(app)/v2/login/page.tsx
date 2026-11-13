import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getShellUser } from "@/modules/identity";
import { nextStepFor, safeNext } from "../../_shell/auth";
import { recallRole } from "../../_shell/role-cookie";
import { LoginFlow } from "./LoginFlow";
import { parseLoginRole, parseLoginStep, type LoginRole } from "./steps";

export const metadata: Metadata = { title: ru.app.login.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Вход нового интерфейса: мастер из трёх шагов на одной странице — что человек хочет сделать, номер, код. Шаг — в адресе
 * (`?step=phone`, `?step=code`): перезагрузка и «Назад» браузера ведут себя ожидаемо; номер телефона в адрес не попадает.
 * `role` (ссылки главной) предвыбирает карточку первого шага, иначе — прошлый выбор из cookie. `next` — возврат после входа,
 * только путь v2 (safeNext). Вошедший сюда не попадает: его ведёт nextStepFor (обязательный шаг, `next` или дом).
 * identity недоступен — экран гостя: плашку «сервис недоступен» показывает оболочка.
 */
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNext(one(params.next));
  const [{ user }, chosen] = await Promise.all([getShellUser(), recallRole()]);
  if (user) redirect(nextStepFor(user, next, chosen));

  const remembered: LoginRole | null = chosen === "EXECUTOR" ? "executor" : chosen === "CLIENT" ? "client" : null;
  return <LoginFlow step={parseLoginStep(one(params.step))} role={parseLoginRole(one(params.role)) ?? remembered} next={next} />;
}
