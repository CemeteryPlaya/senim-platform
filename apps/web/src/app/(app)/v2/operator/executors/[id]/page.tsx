import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { ActionDock, Card, EmptyState, KeyValueList, PageTitle, Section, Split, Stack, StatusChip, Steps, TextLink, Timeline, type KeyValueItem } from "@/kit";
import { formatPhone, type CurrentUser } from "@/modules/identity";
import { getExecutorCard } from "@/modules/operator";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { historyItems, registrationSteps, STATUS_TONE } from "../_parts/view";
import { requisitesOf } from "./_parts/requisites";
import { ReviewForms, ReviewProvider, ReviewSubmit } from "./_parts/ReviewForms";
import { SegmentForm } from "./_parts/SegmentForm";

const q = ru.app.operatorQueues;
const c = q.executors.card;

export const metadata: Metadata = { title: q.executors.metaTitle };

async function loadCard(user: CurrentUser, id: string) {
  try {
    return await getExecutorCard(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

type ExecutorCard = Awaited<ReturnType<typeof loadCard>>;

/** Данные исполнителя: статус и сегмент, телефон, опыт, специализация, адрес, о себе, причина отказа (реквизиты — отдельным блоком). */
function detailsOf(x: ExecutorCard): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      label: c.status,
      value: (
        <span className="flex flex-wrap gap-2">
          <StatusChip tone={STATUS_TONE[x.status]}>{q.registration[x.status]}</StatusChip>
          {x.addedByOperator && <StatusChip tone="neutral">{c.addedByOperator}</StatusChip>}
        </span>
      ),
    },
    { label: c.segment, value: x.segment ? q.segments[x.segment] : q.noSegment },
    { label: c.phone, value: <TextLink href={`tel:${x.phone}`}><span className="tabular-nums">{formatPhone(x.phone)}</span></TextLink> },
    { label: c.registered, value: formatDate(x.createdAt) },
    { label: c.experience, value: c.years(x.yearsExperience) },
    { label: c.specializations, value: x.specializations.map((s) => s.name).join(", ") || q.none },
    { label: c.address, value: x.city.trim() || q.none },
    { label: c.about, value: <span className="whitespace-pre-line">{x.about || q.none}</span> },
  ];
  if (x.rejectReason) items.push({ label: c.rejectReason, value: <span className="whitespace-pre-line">{x.rejectReason}</span> });
  return items;
}

/** Реквизиты для сверки ввода: номера — последние 4 символа (`requisitesOf`). */
function requisiteItems(x: ExecutorCard): KeyValueItem[] {
  return requisitesOf(x).map((row) => ({ label: row.label, value: row.numeric ? <span className="tabular-nums">{row.value}</span> : row.value }));
}

/**
 * Карточка исполнителя: первым — решение, если регистрация ждёт (подтвердить с сегментом — главное действие экрана,
 * отклонить — тихая кнопка с окном причины); у подтверждённого — смена сегмента с причиной. Рядом (на компьютере справа)
 * — ход регистрации (пока регистрация ждёт или отклонена) и история из журнала. Форма и город — в «Реквизитах» и «Адресе»,
 * под заголовком их не повторяем. «Назад» — к списку исполнителей.
 */
export default async function ExecutorCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOperator(to(`/operator/executors/${encodeURIComponent(id)}`));
  const [x, device] = await Promise.all([loadCard(user, id), getDevice()]);
  const history = historyItems(x.history);

  const main = (
    <Stack gap="section">
      {x.status === "PENDING" && (
        <Section title={c.review.title} id="review">
          <ReviewForms device={device} />
        </Section>
      )}
      <Section title={c.details} id="details">
        <Card padded={false}>
          <KeyValueList items={detailsOf(x)} />
        </Card>
      </Section>
      <Section title={c.requisites.title} id="requisites">
        <Card padded={false}>
          <KeyValueList items={requisiteItems(x)} />
        </Card>
      </Section>
      {x.status === "APPROVED" && x.segment && <SegmentForm key={x.segment} profileId={x.id} current={x.segment} />}
    </Stack>
  );
  const aside = (
    <Stack gap="section">
      {/* У подтверждённого ход не показываем: итог — чип «Подтверждён», шаги с датами — в «Истории». */}
      {x.status !== "APPROVED" && (
        <Section title={c.progress} id="progress">
          <Card>
            <Steps items={registrationSteps(x.status)} label={c.progress} />
          </Card>
        </Section>
      )}
      <Section title={c.history} id="history">
        {history.length === 0 ? (
          <EmptyState title={c.historyEmpty.title} body={c.historyEmpty.body} />
        ) : (
          <Card>
            <Timeline items={history} label={c.history} />
          </Card>
        )}
      </Section>
    </Stack>
  );

  const page = (
    <Stack gap="section">
      <PageTitle title={q.executor(x.publicNumber, x.legalName)} back={{ href: to("/operator/executors"), label: c.back }} />
      <Split main={main} aside={aside} />
      {/* Телефон: главная кнопка решения — в доке внизу экрана (последний элемент страницы), форма — в карточке «Решение». */}
      {x.status === "PENDING" && device === "mobile" && (
        <ActionDock>
          <ReviewSubmit full />
        </ActionDock>
      )}
    </Stack>
  );
  return x.status === "PENDING" ? <ReviewProvider profileId={x.id}>{page}</ReviewProvider> : page;
}
