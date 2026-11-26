import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Narrow, NowNext, PageTitle, Stack, TextLink } from "@/kit";
import { getOwnKyc, getOwnPayout } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { pageHref, requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { masterBack } from "../_parts/company-view";
import { kycNow, showAgainLink, showForm } from "./kyc-view";
import { KycForm } from "./KycForm";

const t = ru.app.masterCompany.kyc;
const REGISTER = to("/register/executor");

export const metadata: Metadata = { title: t.metaTitle };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * «Проверка документов» мастера: статус, причина отказа и загрузка удостоверения и документа о регистрации. Открыта мастеру
 * на проверке и после отказа («что можно сделать, пока ждёте»); нет профиля мастера — на регистрацию. Не подано и отказ —
 * форма сразу; «на проверке» — только по ссылке «Отправить документы заново» (`?again=1`); проверенные заменять нельзя.
 * Номера документов на экране не показываются: только состояние и число файлов.
 */
export default async function KycPage({ searchParams }: Props) {
  const params = await searchParams;
  const { user, status } = await requireMaster(pageHref("/executor/profile/kyc", params));
  if (status === "none") redirect(REGISTER);
  const kyc = await getOwnKyc(user).catch((e: unknown) => {
    if (isAppError(e) && e.code === "FORBIDDEN") return null;
    throw e;
  });
  if (kyc === null) redirect(REGISTER);

  const again = params.again === "1";
  // Счёт читаем только у проверенных: от него зависит «Дальше».
  const payoutSet = kyc.state === "VERIFIED" ? (await getOwnPayout(user)).last4 !== null : false;
  const now = kycNow(kyc.state, kyc.rejectReason, kyc.documents.id + kyc.documents.registration, { again, payoutSet });
  const device = await getDevice();
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={masterBack(status === "approved")} />
        <Stack>
          <NowNext
            now={{
              title: now.title,
              body: now.uploaded ? `${now.body} ${now.uploaded}.` : now.body,
            }}
            {...(now.next ? { next: now.next } : {})}
          />
          {showAgainLink(kyc.state, kyc.canSubmit, again) && <TextLink href={`${to("/executor/profile/kyc")}?again=1`}>{t.again}</TextLink>}
        </Stack>
        {showForm(kyc.state, kyc.canSubmit, again) && <KycForm device={device} />}
      </Stack>
    </Narrow>
  );
}
