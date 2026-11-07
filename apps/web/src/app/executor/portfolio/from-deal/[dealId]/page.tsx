import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDealPortfolioDraft, listFurnitureTypes } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { isAppError } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { Alert, ButtonLink, Container, PageHeader } from "@/ui";
import { FromDealForm } from "../FromDealForm";
import { FromDealNote } from "../FromDealNote";

const t = ru.companies.dealPortfolio;

export const metadata: Metadata = { title: t.form.title };

type Props = { params: Promise<{ dealId: string }> };

/**
 * «Добавить в портфолио» из завершённой сделки (встреча 31.10, п. 3): итоговые фото сдачи работы,
 * тип и стиль из заявки, место — город, район или ЖК. Чужая сделка — 404; незавершённая — объяснение.
 */
export default async function FromDealPage({ params }: Props) {
  if (!isEnabled("dealPortfolio")) notFound();
  const { dealId } = await params;
  const user = await requireUserPage(`/executor/portfolio/from-deal/${dealId}`, "EXECUTOR");
  const result = await getDealPortfolioDraft(user, dealId).then(
    (draft) => ({ draft, error: null }),
    (e: unknown) => {
      if (isAppError(e) && e.code === "NOT_FOUND") notFound();
      if (isAppError(e) && e.code === "CONFLICT") return { draft: null, error: e.message };
      throw e;
    },
  );
  const back = { href: `/deals/${dealId}`, label: t.form.back };

  if (!result.draft) {
    return (
      <Container size="form" className="flex flex-col gap-6 pb-12">
        <PageHeader title={t.form.title} back={back} className="pb-0" />
        <Alert tone="warning">{result.error}</Alert>
      </Container>
    );
  }
  const { draft } = result;

  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.form.title} description={t.form.description(draft.dealNumber)} back={back} className="pb-0" />
      {draft.existingItemId ? (
        <div className="flex flex-col gap-4">
          <FromDealNote dealId={draft.dealId} dealNumber={draft.dealNumber} consent={draft.consent} />
          <p className="text-base text-ink">{t.panel.executorAdded}</p>
          <ButtonLink href={`/executor/portfolio/${draft.existingItemId}`} fullWidth>
            {t.panel.executorOpen}
          </ButtonLink>
        </div>
      ) : draft.photos.length === 0 ? (
        <Alert tone="info">{t.panel.noPhotos}</Alert>
      ) : (
        <>
          {!draft.consent && <Alert tone="info">{t.panel.waitingConsent}</Alert>}
          <FromDealForm
            dealId={draft.dealId}
            photos={draft.photos.map((ph) => ({ id: ph.id, src: ph.src }))}
            types={await listFurnitureTypes()}
            initial={{ furnitureTypeId: draft.furnitureTypeId ?? "", style: draft.style, title: draft.title, place: draft.place }}
          />
        </>
      )}
    </Container>
  );
}
