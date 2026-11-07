import type { Metadata } from "next";
import { AtSign, Eye, Images, Landmark, MapPin, ShieldCheck, Store, Wallet } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getOwnProfile, listFurnitureTypes } from "@/modules/companies";
import { canGrant, requireUserPage } from "@/modules/identity";
import { Alert, Container, LinkList, PageHeader } from "@/ui";
import { BecomeClientButton } from "../../_components/auth/RoleButtons";
import { SegmentBadge } from "../../catalog/_components/executor-bits";
import { ProfileForm } from "./ProfileForm";

const t = ru.companies.profile;
const x = ru.executor.profile;

export const metadata: Metadata = { title: t.title };

/** Профиль исполнителя: что видят заказчики. Сегмент только показывается — его ставит оператор. */
export default async function ExecutorProfilePage() {
  const user = await requireUserPage("/executor/profile", "EXECUTOR");
  const [profile, types] = await Promise.all([getOwnProfile(user), listFurnitureTypes()]);

  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />

      {profile.status === "PENDING" && <Alert tone="info">{t.status.PENDING}</Alert>}
      {profile.status === "REJECTED" && (
        <Alert tone="danger" title={t.status.REJECTED}>
          {profile.rejectReason && t.status.rejectReason(profile.rejectReason)}
        </Alert>
      )}

      <section aria-labelledby="public-as" className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-soft [&_svg]:size-8">
            <Store />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="public-as" className="text-lg font-bold break-words text-ink">
              {t.publicAs(profile.label)}
            </h2>
            {profile.city && (
              <p className="flex items-center gap-1 text-base text-muted">
                <MapPin aria-hidden className="size-5 shrink-0" />
                {[profile.city, profile.district].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4 border-t border-line pt-4">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{t.segment}</dt>
            <dd className="flex flex-col items-start gap-1">
              <SegmentBadge segment={profile.segment} />
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
      </section>

      {profile.status === "APPROVED" && (
        <nav aria-label={x.sections}>
          <LinkList
            items={[
              { href: `/executors/${profile.publicNumber}`, label: x.publicProfile, icon: <Eye /> },
              { href: "/executor/portfolio", label: x.portfolio, icon: <Images /> },
              { href: "/executor/finance", label: x.finance, icon: <Wallet /> },
            ]}
          />
        </nav>
      )}

      {/* Документы, счёт для выплаты и контакты — личное мастера, заказчикам не показывается. */}
      <nav aria-label={ru.identity.kyc.title}>
        <LinkList
          items={[
            { href: "/executor/profile/kyc", label: ru.identity.kyc.link, icon: <ShieldCheck /> },
            { href: "/executor/profile/payout", label: ru.identity.payout.link, icon: <Landmark /> },
            { href: "/profile/contacts", label: ru.identity.contacts.link, icon: <AtSign /> },
          ]}
        />
      </nav>

      <section aria-labelledby="profile-edit" className="flex flex-col gap-5 border-t border-line pt-6">
        <h2 id="profile-edit" className="text-xl font-bold text-ink">
          {x.edit}
        </h2>
        <ProfileForm
          initial={{
            about: profile.about,
            yearsExperience: profile.yearsExperience,
            specializationIds: profile.specializationIds,
            measurementTerms: profile.measurementTerms,
            measurementFee: profile.measurementFee,
            city: profile.city,
            district: profile.district,
            streetAddress: profile.streetAddress,
          }}
          types={types}
        />
      </section>

      {/* Исполнитель может заказывать мебель на этом же номере (ADR-004): роль заказчика выдаётся сразу. */}
      {canGrant(user.roles, "CLIENT") && (
        <Alert tone="accent" title={ru.identity.becomeClient.title} action={<BecomeClientButton />}>
          {ru.identity.becomeClient.text}
        </Alert>
      )}
    </Container>
  );
}
