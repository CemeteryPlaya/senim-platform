import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { EmptyState, Narrow, PageTitle, Stack } from "@/kit";
import { HIGHLIGHTS_MAX, listHighlightCandidates } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { BestForm } from "./_parts/BestForm";

const t = ru.app.masterPortfolio.best;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Лучшие работы»: до 6 работ и сделок на странице мастера; порядок — стрелками, «Сохранить» — главное действие.
 * Выбор открыт одобренному мастеру (так отвечает и модуль): остальные возвращаются в портфолио. Нет что выбирать —
 * обучающий экран. «Назад» — «Портфолио».
 */
export default async function BestPage() {
  const { user, status } = await requireMaster(to("/executor/portfolio/best"));
  const back = to("/executor/portfolio");
  if (status !== "approved") redirect(back);
  const device = await getDevice();
  const { items, hiddenDeals } = await listHighlightCandidates(user);
  const title = <PageTitle title={t.title} back={{ href: back, label: t.back }} lead={t.lead} />;
  if (items.length === 0) {
    return (
      <Stack gap="section">
        {title}
        <Narrow>
          <Stack>
            <EmptyState title={t.empty.title} body={t.empty.body} />
            {hiddenDeals > 0 && <p className="text-sub text-muted">{t.hiddenDeals(hiddenDeals)}</p>}
          </Stack>
        </Narrow>
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      <BestForm
        candidates={items.map(({ kind, id, title: name, photo, selected, position }) => ({ kind, id, title: name, photo, selected, position }))}
        hiddenDeals={hiddenDeals}
        max={HIGHLIGHTS_MAX}
        backHref={back}
        device={device}
      />
    </Stack>
  );
}
