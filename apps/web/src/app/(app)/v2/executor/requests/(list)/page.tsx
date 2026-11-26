import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Chips, EmptyState, PageTitle, Stack, TextLink } from "@/kit";
import { listIncomingRequests } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { pageHref, requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { readForMaster, REGISTER } from "../../_parts/approved";
import { IncomingRows } from "../../_parts/IncomingRows";
import { incomingListView, type IncomingListView } from "../../_parts/incoming-view";
import { GATE_BACK, MasterGate } from "../../_parts/MasterGate";

const t = ru.app.masterRequests.incoming;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** Чипы и строки заявок; пустой раздел — подсказка со ссылкой на все заявки. */
function Incoming({ view }: { view: IncomingListView }) {
  return (
    <Stack>
      <Chips label={t.chipsLabel} items={view.chips} />
      {view.empty === "filter" ? (
        <Stack gap="tight">
          <EmptyState title={t.emptyFilter.title} body={t.emptyFilter.body} />
          <TextLink href={to("/executor/requests")}>{t.emptyFilter.showAll}</TextLink>
        </Stack>
      ) : (
        <IncomingRows cards={view.cards} />
      )}
    </Stack>
  );
}

/**
 * «Заявки» мастера: входящие — тендеры его уровня и прямые заявки ему. Раздел — чипом в адресе (`?f=new|direct`,
 * `?type=<тип мебели>`), у каждой заявки: что нужно, город, сегмент, срок, метки «Новая» и «Прямая заявка вам». Покупатель
 * здесь не назван: его имя и контакты открываются только после оферты. Пусто — обучающий экран; неодобренный мастер —
 * экран статуса с одним следующим шагом.
 */
export default async function IncomingPage({ searchParams }: Props) {
  const params = await searchParams;
  const { user, status } = await requireMaster(pageHref("/executor/requests", params));
  const device = await getDevice();
  const read = await readForMaster(user, status, () => listIncomingRequests(user));
  if ("gate" in read) {
    if (read.gate === "none") redirect(REGISTER);
    return <MasterGate status={read.gate} title={t.title} device={device} back={GATE_BACK} />;
  }

  const view = incomingListView(read.data, { f: one(params.f), type: one(params.type) });
  const title = <PageTitle title={t.title} />;

  if (view.empty === "none") {
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.empty.title} body={t.empty.body} action={{ href: to("/executor/profile"), label: t.empty.action }} />
      </Stack>
    );
  }

  // «Мои предложения» — одной ссылкой под списком на обоих устройствах (карточка с заголовком и пересказом называла бы
  // одно место трижды). Компьютер — одна колонка 760 px по центру (разбор 3.9); предпросмотр заявки справа не делаем:
  // он потребовал бы нового адреса выбранной заявки.
  return (
    <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      {title}
      <Incoming view={view} />
      <TextLink href={to("/executor/offers")}>{t.myOffers}</TextLink>
    </Stack>
  );
}
