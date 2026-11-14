import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, NowNext, PageTitle, Stack, TextLink } from "@/kit";
import type { Device } from "@/platform/device";
import type { MasterStatus } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";

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
  link,
}: {
  status: GateStatus;
  title: string;
  device: Device;
  /** «Назад» вложенного экрана (заявка, сделка): разделы до одобрения закрыты, поэтому обычно — на главную. Без него — как раньше. */
  back?: { href: string; label: string };
  /** Второстепенная ссылка под «Сейчас» (например, «Ваши сделки», когда они есть, а вкладки «Сделки» до одобрения нет). */
  link?: { href: string; label: string };
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
        {link && <TextLink href={link.href}>{link.label}</TextLink>}
      </Stack>
      {device === "mobile" && action}
    </Stack>
  );
}
