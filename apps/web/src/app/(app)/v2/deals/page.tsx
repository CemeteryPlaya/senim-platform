import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { HelpBlock, PageTitle, Split, Stack } from "@/kit";
import { listDeals, nextStepsOf, type NextStep } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { logger } from "@/platform/logger";
import { pageHref, requireBuyer, switchRoleTo } from "../../_shell/auth";
import { DealList } from "./_parts/DealList";
import { dealHelpItems } from "./_parts/help-items";
import { payWaitingMaster } from "../_parts/pay-waits";
import { dealListView } from "./_parts/list-view";

const t = ru.app.deal.list;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * «Сделки» покупателя: группы чипами («Идут» / «Завершены»), карточки-ссылки (название, статус, ход, деньги из журнала,
 * признак «нужно ваше действие»). Сделки, где человек — мастер, сюда не попадают: если они есть, — строка-ссылка на
 * переключение роли (экран сделок мастера пока в v1). Пусто — обучающий экран с «Заказать мебель». Телефон — одна колонка;
 * компьютер — список слева, «Помощь» справа.
 */
export default async function DealsPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireBuyer(pageHref("/deals", params));
  const all = await listDeals(user);
  const mine = all.filter((d) => d.myRole === "CLIENT");
  const nexts = await nextStepsOf(
    user,
    mine.map((d) => d.id),
  ).catch((error: unknown) => {
    // Сбой чтения не роняет список: карточки покажутся без признака «нужно ваше действие».
    logger.warn("deals next steps failed", { error });
    return new Map<string, NextStep>();
  });
  const waiting = await payWaitingMaster(user, nexts);
  const view = dealListView(mine, nexts, typeof params.group === "string" ? params.group : undefined, waiting);
  const otherRole =
    user.roles.includes("EXECUTOR") && all.some((d) => d.myRole === "EXECUTOR") ? switchRoleTo("EXECUTOR") : null;
  const device = await getDevice();

  const help = (
    <HelpBlock
      items={dealHelpItems()}
      supportEmail={brand.support.email}
    />
  );
  const list = <DealList view={view} otherRole={otherRole} />;

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      {device === "desktop" ? (
        <Split main={list} aside={help} />
      ) : (
        <>
          {list}
          {help}
        </>
      )}
    </Stack>
  );
}
