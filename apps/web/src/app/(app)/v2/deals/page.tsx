import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { HelpBlock, PageTitle, Stack } from "@/kit";
import { listDeals, nextStepsOf, type NextStep } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { logger } from "@/platform/logger";
import { masterStatusOf, pageHref, requireParty, switchRoleTo } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import type { DealSide } from "../../_shell/side";
import { REGISTER } from "../executor/_parts/approved";
import { GATE_BACK, MasterGate } from "../executor/_parts/MasterGate";
import { DealList } from "./_parts/DealList";
import { dealHelpItems } from "./_parts/help-items";
import { consentMissingOf, payWaitingMaster } from "../_parts/pay-waits";
import { dealListView } from "./_parts/list-view";

const t = ru.app.deal.list;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Другая сторона сделки: роль, в которой у человека могут быть сделки, кроме активной. */
const OTHER: Record<DealSide, DealSide> = { CLIENT: "EXECUTOR", EXECUTOR: "CLIENT" };

/**
 * «Сделки» стороны в активной роли (`requireParty`): группы чипами («Идут» / «Завершены»), карточки-ссылки (название,
 * статус, ход, деньги из журнала по стороне). Сделки другой роли сюда не попадают: если они есть и роль выдана, — строка-ссылка
 * на переключение роли. Пусто — обучающий экран с одним действием стороны (покупателю — «Заказать мебель», мастеру —
 * «Открыть заявки»). Мастер без одобрения и без сделок — экран статуса проверки, а не пустой список. Одна колонка на обоих
 * устройствах (компьютер — 760 px по центру), «Помощь» — под списком.
 */
export default async function DealsPage({ searchParams }: Props) {
  const params = await searchParams;
  const { user, side } = await requireParty(pageHref("/deals", params));
  const all = await listDeals(user);
  const mine = all.filter((d) => d.myRole === side);
  const device = await getDevice();
  const status = masterStatusOf(user);
  if (side === "EXECUTOR" && status !== "approved" && mine.length === 0) {
    if (status === "none") redirect(REGISTER);
    return <MasterGate status={status} title={ru.app.masterDeal.list.gateTitle} device={device} back={GATE_BACK} />;
  }
  const nexts = await nextStepsOf(
    user,
    mine.map((d) => d.id),
  ).catch((error: unknown) => {
    // Сбой чтения не роняет список: карточки покажутся без признака «нужно ваше действие».
    logger.warn("deals next steps failed", { error });
    return new Map<string, NextStep>();
  });
  const bankWaits = side === "CLIENT" ? await payWaitingMaster(user, nexts) : await consentMissingOf(user, nexts);
  const view = dealListView(mine, nexts, typeof params.group === "string" ? params.group : undefined, bankWaits, side);
  const other = OTHER[side];
  // После переключения роли человек остаётся в «Сделках» — уже другой роли.
  const otherRole = user.roles.includes(other) && all.some((d) => d.myRole === other) ? switchRoleTo(other, to("/deals")) : null;

  const help = <HelpBlock items={dealHelpItems(side)} supportEmail={brand.support.email} />;
  const list = <DealList view={view} otherRole={otherRole} side={side} />;

  // Одна колонка на обоих устройствах (компьютер — 760 px по центру): «Помощь» — под списком, а не одна в правой колонке.
  return (
    <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <PageTitle title={t.title} />
      {list}
      {help}
    </Stack>
  );
}
