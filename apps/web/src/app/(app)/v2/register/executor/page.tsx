import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { listDeals } from "@/modules/deal-core";
import { getMyRegistration, getOwnKyc, getShellUser, type CurrentUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { logger } from "@/platform/logger";
import { masterStatusOf, requireV2User } from "../../../_shell/auth";
import { becomingMaster } from "../../../_shell/role-choice";
import { recallRole } from "../../../_shell/role-cookie";
import { initialAnswers, parseStep, REGISTER_PATH } from "./_parts/steps";
import { RegisterGuest, RegisterStatus, type KycState } from "./RegisterStatus";
import { RegisterWizard } from "./RegisterWizard";

export const metadata: Metadata = { title: ru.app.masterRegister.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Регистрация мастера — дом заказчика, выбравшего «Я мастер», и мастера до одобрения (`homeFor`):
 * - гость — что нужно и вход с ролью мастера и возвратом сюда; вошедший при недоступном identity — не гость: общая
 *   ошибка оболочки (плашка «сервис недоступен» и граница ошибок группы с «Повторить»);
 * - нет профиля — анкета по шагам (`?step=`);
 * - на проверке, одобрено, отказ — экран статуса (у мастера со сделками — ссылка «Ваши сделки»); после отказа `?step=` открывает ту же анкету заново.
 *
 * Ворота — `requireV2User` с обеими ролями (правило 2 у requireV2User), а не `requireMaster`: заказчик без профиля тоже
 * попадает сюда. Оператор и замерщик уходят в свой дом, непройденные первые шаги (согласие, ФИО и ИИН, почта) — на них.
 * В разметку и RSC попадают только последние 4 цифры ИИН/БИН.
 */
export default async function RegisterExecutorPage({ searchParams }: Props) {
  const step = parseStep(one((await searchParams).step));
  const { user: shellUser, unavailable } = await getShellUser();
  if (!shellUser && !unavailable) return <RegisterGuest />;

  // identity недоступен — requireV2User бросает UNAVAILABLE: страницу заменяет граница ошибок группы (error.tsx).
  const user = await requireV2User(REGISTER_PATH, "CLIENT", "EXECUTOR");
  const [registration, device] = await Promise.all([getMyRegistration(user), getDevice()]);
  if (registration && (registration.status !== "REJECTED" || step === null)) {
    const kyc = registration.status === "PENDING" ? await kycStateOf(user) : null;
    const hasDeals = registration.status !== "APPROVED" && (await hasMasterDeals(user));
    return <RegisterStatus registration={registration} kyc={kyc} hasDeals={hasDeals} />;
  }

  const rejected = registration !== null;
  // Анкета — дом (homeFor): у мастера без профиля и у идущего к профилю мастера; «Назад» на главную вело бы сюда же.
  const toMaster = becomingMaster(user, await recallRole());
  const isHome = toMaster || (user.role === "EXECUTOR" && masterStatusOf(user) === "none");
  return (
    <RegisterWizard
      step={step}
      initial={initialAnswers(rejected ? { legalForm: registration.legalForm, legalName: registration.legalName } : null)}
      origin={rejected ? "status" : "home"}
      rejectReason={registration?.rejectReason ?? null}
      ownIinLast4={user.iinLast4}
      fullName={user.fullName}
      keepsBuyer={user.roles.includes("CLIENT") && !user.roles.includes("EXECUTOR")}
      isHome={isHome}
      becomingMaster={toMaster}
      storageKey={`senim.master-register:${user.id}`}
      device={device}
    />
  );
}

/**
 * Состояние документов мастера для экрана «на проверке»: от него зависит главное действие. Сбой чтения (identity,
 * роль) — `null`: экран рисуется без главного действия, со ссылкой на документы.
 */
async function kycStateOf(user: CurrentUser): Promise<KycState | null> {
  try {
    return (await getOwnKyc(user)).state;
  } catch (e) {
    logger.warn("app.masterRegister.kyc_unavailable", { error: e });
    return null;
  }
}

/**
 * Есть ли у мастера сделки (одобрение сняли или ещё не пришло): вкладки «Сделки» до одобрения нет, ссылка — на экране
 * статуса. Только в роли мастера: в роли заказчика «Сделки» — это сделки покупателя. Сбой чтения — «нет»: ссылка не нужна.
 */
async function hasMasterDeals(user: CurrentUser): Promise<boolean> {
  if (user.role !== "EXECUTOR") return false;
  try {
    return (await listDeals(user)).some((d) => d.myRole === "EXECUTOR");
  } catch (e) {
    logger.warn("app.masterRegister.deals_unavailable", { error: e });
    return false;
  }
}
