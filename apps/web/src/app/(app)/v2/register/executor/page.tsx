import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { getMyRegistration, getShellUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { requireV2User } from "../../../_shell/auth";
import { initialAnswers, parseStep, REGISTER_PATH } from "./_parts/steps";
import { RegisterGuest, RegisterStatus } from "./RegisterStatus";
import { RegisterWizard } from "./RegisterWizard";

export const metadata: Metadata = { title: ru.app.masterRegister.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Регистрация мастера — дом заказчика, выбравшего «Я мастер», и мастера до одобрения (`homeFor`):
 * - гость — что нужно и вход с ролью мастера и возвратом сюда (identity недоступен — тоже экран гостя);
 * - нет профиля — анкета по шагам (`?step=`);
 * - на проверке, одобрено, отказ — экран статуса; после отказа `?step=` открывает ту же анкету заново.
 *
 * Ворота — `requireV2User` с обеими ролями (правило 2 у requireV2User), а не `requireMaster`: заказчик без профиля тоже
 * попадает сюда. Оператор и замерщик уходят в свой дом, непройденные первые шаги (согласие, ФИО и ИИН, почта) — на них.
 * В разметку и RSC попадают только последние 4 цифры ИИН/БИН.
 */
export default async function RegisterExecutorPage({ searchParams }: Props) {
  const step = parseStep(one((await searchParams).step));
  const { user: shellUser } = await getShellUser();
  if (!shellUser) return <RegisterGuest />;

  const user = await requireV2User(REGISTER_PATH, "CLIENT", "EXECUTOR");
  const [registration, device] = await Promise.all([getMyRegistration(user), getDevice()]);
  if (registration && (registration.status !== "REJECTED" || step === null)) {
    return <RegisterStatus registration={registration} device={device} />;
  }

  const rejected = registration !== null;
  return (
    <RegisterWizard
      step={step}
      initial={initialAnswers(rejected ? { legalForm: registration.legalForm, legalName: registration.legalName } : null)}
      origin={rejected ? "status" : "home"}
      ownIinLast4={user.iinLast4}
      fullName={user.fullName}
      keepsBuyer={user.roles.includes("CLIENT") && !user.roles.includes("EXECUTOR")}
      storageKey={`senim.master-register:${user.id}`}
      device={device}
    />
  );
}
