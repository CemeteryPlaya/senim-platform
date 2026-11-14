import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, NowNext, PageTitle, Stack, TextLink } from "@/kit";
import { getOwnPayout } from "@/modules/identity";
import { hasPendingPayout } from "@/modules/payments";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { SUPPORT_HREF } from "../../../../_shell/support";
import { accountLine, payoutNow } from "./payout-view";
import { PayoutForm } from "./PayoutForm";

const t = ru.app.masterCompany.payout;
const REGISTER = to("/register/executor");

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Счёт для оплаты» мастера: на экране только последние 4 знака счёта («KZ •••• 0100»). Открыт мастеру на проверке и после
 * отказа; нет профиля мастера — на регистрацию. Пока банк проводит оплату по сделке (часть мастера в обработке), смена
 * закрыта: объяснение и ссылка в поддержку вместо формы (сервер проверяет то же самое). Иначе — форма и главное действие
 * «Сохранить счёт».
 */
export default async function PayoutPage() {
  const { user, status } = await requireMaster(to("/executor/profile/payout"));
  if (status === "none" || !user.executor) redirect(REGISTER);
  const executorId = user.executor.id;
  const [read, device] = await Promise.all([
    Promise.all([getOwnPayout(user), hasPendingPayout(executorId)]).catch((e: unknown) => {
      if (isAppError(e) && e.code === "FORBIDDEN") return null;
      throw e;
    }),
    getDevice(),
  ]);
  if (read === null) redirect(REGISTER);
  const [{ last4 }, locked] = read;
  const now = payoutNow(last4, locked);

  return (
    <Stack gap="section">
      <PageTitle title={t.title} back={{ href: to("/executor/profile"), label: ru.app.masterCompany.shared.backCompany }} />
      <Stack>
        <NowNext now={{ title: now.title, body: now.body }} {...(now.next ? { next: now.next } : {})} />
        <Card padded={false}>
          <List>
            <ListRow label={t.account} value={<span className="tabular-nums">{accountLine(last4)}</span>} />
          </List>
        </Card>
        {locked && <TextLink href={SUPPORT_HREF}>{t.support}</TextLink>}
      </Stack>
      {!locked && <PayoutForm device={device} />}
    </Stack>
  );
}
