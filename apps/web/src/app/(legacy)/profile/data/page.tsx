import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { dealNumbersOf } from "@/modules/deal-core";
import { consentDocument, formatPhone, getMyData, requireUserPage, type ActiveConsent, type RevocationView } from "@/modules/identity";
import { Alert, Card, Container, DateText, KeyValueList, PageHeader, StatusBadge, type Tone } from "@/ui";
import { ConsentText } from "../../_components/consent/ConsentText";
import { RevokeForm } from "./RevokeForm";

const t = ru.consent.myData;
const r = ru.consent.revoke;

export const metadata: Metadata = { title: t.metaTitle };

const STATUS_TONE: Record<RevocationView["status"], Tone> = { REQUESTED: "warning", COMPLETED: "neutral", REFUSED: "danger" };

/**
 * «Мои данные» (A.7 P7, ст. 24): ФИО, последние 4 цифры ИИН, контакты, действующие согласия с датой и редакцией и отзыв
 * согласия на обработку ПДн — заявкой оператору со сроком 15 рабочих дней. Пока заявка открыта, согласие действует
 * (Ruling P), а кнопки отзыва и «дать заново» нет (Ruling R): экран показывает статус заявки и срок ответа.
 */
export default async function MyDataPage() {
  const user = await requireUserPage("/profile/data", "CLIENT", "EXECUTOR");
  const data = await getMyData(user);
  const numbers = await dealNumbersOf(user, data.consents.flatMap((c) => (c.dealId ? [c.dealId] : [])));
  const open = data.revocation?.status === "REQUESTED";
  const notSet = t.notSet;

  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.description} back={{ href: "/profile" }} />

      <Card as="section" title={t.personTitle} titleId="my-data-person">
        <KeyValueList
          rows={[
            { label: t.rows.fullName, value: data.fullName ?? notSet },
            { label: t.rows.iin, value: data.iinLast4 ? <span className="tabular-nums">{t.iinMasked(data.iinLast4)}</span> : notSet },
            { label: t.rows.phone, value: <span className="tabular-nums">{formatPhone(data.phone)}</span> },
            { label: t.rows.instagram, value: data.instagram ?? notSet },
            { label: t.rows.email, value: data.email ?? notSet },
          ]}
        />
      </Card>

      <Card as="section" title={t.consentsTitle} titleId="my-data-consents">
        {data.consents.length === 0 ? (
          <p className="text-lg text-ink">{t.noConsents}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.consents.map((c) => (
              <ConsentItem key={c.id} consent={c} dealNumber={c.dealId ? numbers.get(c.dealId) : undefined} />
            ))}
          </ul>
        )}
        {data.revocation && <RevocationStatus revocation={data.revocation} />}
        {/* Отзывается только согласие на ПДн (передача банку к сделке нужна для её исполнения); при открытой заявке — нет. */}
        {!open && data.consents.some((c) => c.kind === "PD_PROCESSING") && <RevokeForm />}
      </Card>
    </Container>
  );
}

function ConsentItem({ consent: c, dealNumber }: { consent: ActiveConsent; dealNumber: number | undefined }) {
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-4">
      <p className="text-lg font-semibold text-ink">{ru.consent.kinds[c.kind]}</p>
      <KeyValueList
        rows={[
          { label: t.granted, value: <DateText value={c.grantedAt} format="dateTime" /> },
          { label: t.edition, value: c.version },
        ]}
      />
      {c.dealId && (
        <Link href={`/deals/${c.dealId}`} className="inline-flex min-h-control items-center text-base font-semibold text-primary underline">
          {dealNumber === undefined ? t.dealUnknown : t.deal(dealNumber)}
        </Link>
      )}
      <details className="rounded-control border border-line">
        <summary className="flex min-h-control cursor-pointer items-center px-4 text-base font-semibold text-ink">{t.readText}</summary>
        <div className="px-4 pb-4">
          <ConsentText document={consentDocument(c.kind)} headingLevel="h3" />
        </div>
      </details>
    </li>
  );
}

/** Статус последней заявки на отзыв: когда подана, срок ответа, решение и причина отказа. */
function RevocationStatus({ revocation: rev }: { revocation: RevocationView }) {
  const rows = [
    { label: r.requestedAt, value: <DateText value={rev.requestedAt} format="dateTime" /> },
    rev.status === "REQUESTED" ? { label: r.dueAt, value: <DateText value={rev.dueAt} /> } : null,
    rev.decidedAt ? { label: r.decidedAt, value: <DateText value={rev.decidedAt} format="dateTime" /> } : null,
    rev.reason ? { label: r.reason, value: rev.reason } : null,
  ].filter((row) => row !== null);
  return (
    <section aria-labelledby="my-data-revocation" className="flex flex-col gap-3 rounded-control border border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="my-data-revocation" className="text-lg font-bold text-ink">
          {r.statusTitle}
        </h3>
        <StatusBadge tone={STATUS_TONE[rev.status]}>{r.status[rev.status]}</StatusBadge>
      </div>
      <KeyValueList rows={rows} />
      {rev.status === "REQUESTED" && <Alert tone="accent">{r.stillActive}</Alert>}
    </section>
  );
}
