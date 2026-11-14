import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, NowNext, PageTitle, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import type { MasterStatus } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

/**
 * «Назад» экранов статуса вложенных и некорневых экранов мастера (предложения, заявки, сделки, финансы, заявка): до
 * одобрения «Главная» — регистрация и статус проверки (тот же дом, что у вкладки «Главная» и `homeFor`).
 */
export const GATE_BACK = { href: to("/register/executor"), label: ru.app.masterOffer.gateBack };

/** Статус, при котором экраны мастера закрыты: профиль не одобрен. */
export type GateStatus = Exclude<MasterStatus, "approved">;

/**
 * Экран статуса вместо рабочего экрана мастера, пока профиль не одобрен (нет анкеты, проверка, отказ): не ошибка, а
 * «Сейчас / Дальше» и один следующий шаг — на экран регистрации и статуса проверки. Модуль заявок всё равно ответил бы
 * `notApproved`; здесь человек видит причину и куда идти. Телефон — действие в доке, компьютер — под карточкой.
 */
export function MasterGate({
  status,
  title,
  device,
  back,
}: {
  status: GateStatus;
  title: string;
  device: Device;
  /** «Назад» вложенного экрана (заявка, сделка): разделы до одобрения закрыты, поэтому обычно — на главную. Без него — как раньше. */
  back?: { href: string; label: string };
}) {
  const g = ru.app.masterRequests.gate[status];
  const action = (
    <ActionDock>
      <ButtonLink href={to("/register/executor")}>{g.action}</ButtonLink>
    </ActionDock>
  );
  return (
    <Stack gap="section">
      <PageTitle title={title} {...(back ? { back } : {})} />
      <Stack>
        <NowNext now={{ title: g.now, body: g.body }} next={g.next} />
        {device === "desktop" && action}
      </Stack>
      {device === "mobile" && action}
    </Stack>
  );
}
