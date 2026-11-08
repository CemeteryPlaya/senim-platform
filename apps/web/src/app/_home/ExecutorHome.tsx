import { Images, Ruler, Send, Store } from "lucide-react";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { isEnabled } from "@/platform/features";
import { Container, LinkList, SectionTitle, StatTiles } from "@/ui";
import { IncomingCard } from "../executor/_parts/IncomingCard";
import { executorSummary } from "../executor/_parts/summary";

const t = ru.common.home;
const e = t.executor;
const nav = ru.common.nav;

const SHOWN = 4;

/**
 * Главная мастера в стиле «B + A» (макет master-screens, экран 1): приветствие → сводка плитками (на десктопе — ещё
 * заработок за месяц) → новые заявки карточками → разделы, которых нет на нижней панели. Заявки, заказы, чаты
 * и финансы — вкладки панели; главная кнопка здесь не нужна — действие у мастера в самой заявке («Откликнуться»).
 */
export async function ExecutorHome({ user }: { user: CurrentUser }) {
  const { fresh, tiles } = await executorSummary(user);

  return (
    <Container className="flex flex-col gap-6 pt-4 pb-10 sm:pt-6">
      <h1 className="text-2xl font-extrabold break-words text-ink sm:text-3xl">{t.hello(user.fullName)}</h1>
      <StatTiles label={ru.executor.stats.label} items={tiles} className="lg:grid-cols-3" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="home-incoming" className="flex min-w-0 flex-col gap-3">
          <SectionTitle id="home-incoming" title={e.requestsTitle} action={{ href: "/executor/requests", label: e.allRequests }} />
          {fresh.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-4 text-base text-ink-soft">{e.noRequests}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {fresh.slice(0, SHOWN).map((r) => (
                <li key={r.id} className="flex">
                  <IncomingCard r={r} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav aria-label={e.sections} className="rounded-card border border-line bg-surface px-3 py-1">
          <LinkList
            className="border-y-0"
            items={[
              { href: "/executor/offers", label: ru.executor.offers.title, icon: <Send /> },
              // Замеры до договора — за флагом preContractFlows, как и пункт меню.
              ...(isEnabled("preContractFlows") ? [{ href: "/executor/measurements", label: nav.measurements, icon: <Ruler /> }] : []),
              { href: "/executor/portfolio", label: nav.portfolio, icon: <Images /> },
              { href: "/executor/profile", label: nav.company, icon: <Store /> },
            ]}
          />
        </nav>
      </div>
    </Container>
  );
}
