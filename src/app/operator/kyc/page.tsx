import type { Metadata } from "next";
import { IdCard } from "lucide-react";
import { ru } from "@/i18n/ru";
import { kycQueue } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader } from "@/ui";
import { ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";
import { KycForms } from "./KycForms";

const o = ru.operator;
const t = o.kyc;

export const metadata: Metadata = { title: t.title };

/** KYC мастеров: документы открываются по подписанной ссылке; ИИН/БИН — только последние 4 цифры. */
export default async function KycPage() {
  const user = await requireOperatorPage("/operator/kyc");
  const queue = await kycQueue(user);

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      {queue.length === 0 ? (
        <EmptyState icon={<IdCard />} title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((item) => (
            <ListCard
              key={item.profileId}
              titleAs="h2"
              title={t.executor(item.publicNumber, item.legalName)}
              meta={[
                `${o.legalForms[item.legalForm]}, ${o.binIinMasked(item.binIinLast4)}`,
                <>
                  {t.submitted} <DateText value={item.submittedAt} format="dateTime" />
                </>,
              ]}
            >
              <ul className="flex flex-col gap-2">
                {item.documents.map((d) => (
                  <li key={d.id}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-control items-center text-base text-primary underline">
                      {t.purposes[d.purpose]}
                    </a>
                  </li>
                ))}
              </ul>
              <KycForms profileId={item.profileId} />
            </ListCard>
          ))}
        </ul>
      )}
    </Container>
  );
}
