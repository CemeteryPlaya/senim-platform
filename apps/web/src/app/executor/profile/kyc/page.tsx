import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { getOwnKyc, KYC_MAX_FILES, requireUserPage, type KycState } from "@/modules/identity";
import { Alert, Container, PageHeader, type AlertTone } from "@/ui";
import { KycForm } from "./KycForm";

const t = ru.identity.kyc;
const TONE: Record<KycState, AlertTone> = { NOT_SUBMITTED: "info", PENDING: "info", VERIFIED: "success", REJECTED: "danger" };

export const metadata: Metadata = { title: t.title };

/** «Проверка документов» мастера (решение 2.2.8): статус, причина отказа и загрузка документов. */
export default async function KycPage() {
  const user = await requireUserPage("/executor/profile/kyc", "EXECUTOR");
  const kyc = await getOwnKyc(user);
  const uploaded = kyc.documents.id + kyc.documents.registration;
  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.intro} back={{ href: "/executor/profile" }} />
      <Alert tone={TONE[kyc.state]} title={t.status[kyc.state]}>
        {kyc.rejectReason && <p>{t.rejectReason(kyc.rejectReason)}</p>}
        {uploaded > 0 && <p>{t.uploaded(uploaded)}</p>}
      </Alert>
      {kyc.canSubmit && <KycForm max={KYC_MAX_FILES} />}
    </Container>
  );
}
