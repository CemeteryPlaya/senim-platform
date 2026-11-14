import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getExecutorFinance } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { pageHref, requireMaster } from "../../../_shell/auth";
import { readForMaster, REGISTER } from "../_parts/approved";
import { GATE_BACK, MasterGate } from "../_parts/MasterGate";
import { FinanceScreen } from "./_parts/FinanceScreen";
import { financeView } from "./_parts/finance-view";

const t = ru.app.masterFinance;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * «Финансы» мастера — только одобренному: деньги из журнала (`getExecutorFinance`), месяц — в адресе (`?month=YYYY-MM`,
 * по умолчанию текущий по времени Казахстана; неверный и будущий — текущий). Неодобренный мастер (нет анкеты, на
 * проверке, отказ) видит экран статуса, а не ошибку; то же при отказе модуля. Только чтение: действия — на странице сделки.
 */
export default async function FinancePage({ searchParams }: Props) {
  const params = await searchParams;
  const { user, status } = await requireMaster(pageHref("/executor/finance", params));
  const device = await getDevice();
  const read = await readForMaster(user, status, () => getExecutorFinance(user));
  if ("gate" in read) {
    if (read.gate === "none") redirect(REGISTER);
    return <MasterGate status={read.gate} title={t.title} device={device} back={GATE_BACK} />;
  }
  return <FinanceScreen view={financeView(read.data, params.month, new Date())} device={device} />;
}
