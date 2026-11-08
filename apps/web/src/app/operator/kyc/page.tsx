import type { Metadata } from "next";
import { IdCard } from "lucide-react";
import { ru } from "@/i18n/ru";
import { kycQueue } from "@/modules/operator";
import { Container, DateText, EmptyState, PageHeader } from "@/ui";
import { DecisionQueue } from "../_components/DecisionQueue";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";
import { KycForms } from "./KycForms";

const o = ru.operator;
const t = o.kyc;

export const metadata: Metadata = { title: t.title };

const EMPTY_TITLE_ID = "kyc-queue-empty";

/** KYC мастеров: документы открываются по подписанной ссылке; ИИН/БИН — только последние 4 цифры. */
export default async function KycPage() {
  const user = await requireOperatorPage("/operator/kyc");
  const queue = await kycQueue(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <DecisionQueue count={queue.length} emptyTitleId={EMPTY_TITLE_ID}>
        {queue.length === 0 ? (
          <EmptyState icon={<IdCard />} title={t.empty} titleId={EMPTY_TITLE_ID} description={t.emptyHint} />
        ) : (
          <ul data-queue className={LIST_GRID}>
            {queue.map((item, i) => (
              <ListCard
                key={item.executorId}
                titleAs="h2"
                title={t.executor(item.publicNumber, item.legalName)}
                meta={[
                  `${o.legalForms[item.legalForm]}, ${o.binIinMasked(item.binIinLast4)}`,
                  <>
                    {t.submitted} <DateText value={item.lastUploadAt} format="dateTime" />
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
                <KycForms executorId={item.executorId} primary={i === 0} />
              </ListCard>
            ))}
          </ul>
        )}
      </DecisionQueue>
    </Container>
  );
}
