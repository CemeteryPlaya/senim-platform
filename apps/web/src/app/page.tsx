import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { parseCatalogFilter, type SearchParams } from "@/modules/companies";
import { getShellUser, homePathFor, requireIntroduced } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ClientHome } from "./_home/ClientHome";
import { ExecutorHome } from "./_home/ExecutorHome";
import { Landing } from "./_home/Landing";

export async function generateMetadata(): Promise<Metadata> {
  const { user } = await getShellUser();
  if (user?.role === "CLIENT") return { title: ru.common.home.clientMeta };
  if (user?.role === "EXECUTOR") return { title: ru.common.home.executorMeta };
  return {};
}

/**
 * «Главная» — первая вкладка: гостю — лендинг, заказчику и подтверждённому исполнителю — их главные экраны
 * по макетам 7–19. У остальных ролей вкладки «Главная» нет: оператор, замерщик и исполнитель на проверке
 * попадают в свой первый раздел (тот же адрес, что после входа). Недоступный identity — лендинг гостя, как в оболочке.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await getShellUser();
  if (!user) return <Landing />;
  if (user.role === "CLIENT") {
    requireIntroduced(user, "/");
    // Чипы цены ленты работ живут в адресе (/?price=…), как фильтры каталога.
    return <ClientHome user={user} price={parseCatalogFilter(await searchParams).price} />;
  }
  if (user.role === "EXECUTOR" && user.executor?.status === "APPROVED") {
    requireIntroduced(user, "/");
    return <ExecutorHome user={user} />;
  }
  redirect(homePathFor(user));
}
