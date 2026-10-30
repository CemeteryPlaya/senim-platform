import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getOwnProfile, listFurnitureTypes } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { Alert, ButtonLink, Container, PageHeader } from "@/ui";
import { SegmentBadge } from "../../catalog/_components/executor-bits";
import { ProfileForm } from "./ProfileForm";

const t = ru.companies.profile;

export const metadata: Metadata = { title: t.title };

/** Профиль исполнителя: что видят заказчики. Сегмент только показывается — его ставит оператор. */
export default async function ExecutorProfilePage() {
  const user = await requireUserPage("/executor/profile", "EXECUTOR");
  const [profile, types] = await Promise.all([getOwnProfile(user), listFurnitureTypes()]);

  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.description} back={{ href: "/" }} className="pb-0" />

      {profile.status === "PENDING" && <Alert tone="info">{t.status.PENDING}</Alert>}
      {profile.status === "REJECTED" && (
        <Alert tone="danger" title={t.status.REJECTED}>
          {profile.rejectReason && t.status.rejectReason(profile.rejectReason)}
        </Alert>
      )}

      <section aria-labelledby="public-as" className="flex flex-col gap-4 rounded-card bg-sunken p-5">
        <h2 id="public-as" className="text-lg font-bold text-ink">
          {t.publicAs(profile.label)}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{t.segment}</dt>
            <dd className="flex flex-col items-start gap-1">
              <SegmentBadge segment={profile.segment} />
              <span className="text-sm text-muted">{t.segmentHint}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{t.legalName}</dt>
            <dd className="flex flex-col gap-1">
              <span className="text-base font-semibold break-words text-ink">{profile.legalName}</span>
              <span className="text-sm text-muted">{t.legalNameHint}</span>
            </dd>
          </div>
        </dl>
        {profile.status === "APPROVED" && (
          <ButtonLink href={`/executors/${profile.publicNumber}`} variant="secondary" iconEnd={<ArrowRight />} className="self-start">
            {t.openPublic}
          </ButtonLink>
        )}
      </section>

      <ProfileForm
        initial={{
          about: profile.about,
          yearsExperience: profile.yearsExperience,
          specializationIds: profile.specializationIds,
          measurementTerms: profile.measurementTerms,
          measurementFee: profile.measurementFee,
        }}
        types={types}
      />
    </Container>
  );
}
