import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { getShellUser } from "@/modules/identity";
import { computeDealMoney } from "@/modules/payments";
import { ActionDock, ButtonLink, Card, List, ListItem, Money, PageTitle, Section, Split, Stack } from "@/kit";
import { getDevice } from "@/platform/device";
import { to } from "../../_shell/paths";
import { loginHref } from "../_home/links";
import { ABOUT_ANCHORS } from "./anchors";

const t = ru.app.guest.about;

export const metadata: Metadata = { title: t.title };

/** Цена в примерах раздела «Сколько это стоит»: 200 000 ₸ в тиынах. Остальные суммы считает `computeDealMoney`. */
const EXAMPLE_PRICE_TIYN = 200_000n * 100n;

/** Абзацы раздела в одной карточке. */
function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <Card>
      <Stack>
        {items.map((text) => (
          <p key={text} className="text-body text-ink">
            {text}
          </p>
        ))}
      </Stack>
    </Card>
  );
}

type Action = { href: string; label: string } | null;

/** Главное действие по роли: гость — вход покупателем, заказчик — новая заявка, остальные роли — без главного действия. */
function primaryAction(role: string | null): Action {
  if (role === null) return { href: loginHref("client"), label: t.clientAction };
  if (role === "CLIENT") return { href: to("/requests/new"), label: t.createRequest };
  return null;
}

/**
 * «О сервисе»: четыре раздела с якорями (деньги, цена по ролям с примером, что делать с мебелью, как стать мастером).
 * Компьютер — `Split` с прилипающей правой колонкой: оглавление (ссылки-якоря, без шевронов) и карточка с единственным
 * главным действием; внизу страницы кнопки нет. Телефон — одна колонка и `ActionDock` в конце. Вошедшему заказчику
 * действие ведёт на новую заявку, мастеру и оператору главного действия нет, и ссылка регистрации мастера им не
 * показывается. Якоря и порядок — в `anchors.ts`.
 */
export default async function AboutPage() {
  const [{ user }, device] = await Promise.all([getShellUser(), getDevice()]);
  const role = user?.role ?? null;
  const action = primaryAction(role);
  const canBecomeMaster = role === null || role === "CLIENT";
  const money = computeDealMoney(EXAMPLE_PRICE_TIYN);
  const toc = [
    { id: ABOUT_ANCHORS.money, label: t.money.title },
    { id: ABOUT_ANCHORS.price, label: t.price.title },
    { id: ABOUT_ANCHORS.refusal, label: t.refusal.title },
    { id: ABOUT_ANCHORS.master, label: t.master.title },
  ];

  const aside = (
    <Stack>
      <Section title={t.tocTitle}>
        <Card padded={false}>
          <List>
            {toc.map((item) => (
              <ListItem key={item.id}>
                {/* Якорь на этой же странице: без шеврона (ListRow с адресом рисует шеврон — он про переход). */}
                <a
                  href={`${to("/about")}#${item.id}`}
                  className="flex min-h-control w-full items-center px-4 py-3 text-body text-ink no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
                >
                  {item.label}
                </a>
              </ListItem>
            ))}
          </List>
        </Card>
      </Section>
      {action && (
        <Card>
          <ButtonLink href={action.href} full>
            {action.label}
          </ButtonLink>
        </Card>
      )}
    </Stack>
  );

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} back={{ href: to("/"), label: t.backLabel }} />
      <Split
        stickyAside={device === "desktop"}
        main={
          <Stack gap="section">
            <Section id={ABOUT_ANCHORS.money} title={t.money.title}>
              <Paragraphs items={t.money.paragraphs} />
            </Section>
            <Section id={ABOUT_ANCHORS.price} title={t.price.title}>
              <Card as="article">
                <h3 className="text-card text-ink">{t.price.buyerTitle}</h3>
                <p className="mt-1 text-body text-ink">
                  {t.price.buyerPrice} <Money tiyn={money.priceTiyn} /> — {t.price.buyerPays}{" "}
                  <Money tiyn={money.buyerTotalTiyn} />
                </p>
                <p className="mt-1 text-body text-muted">{t.price.buyerNote}</p>
              </Card>
              <Card as="article">
                <h3 className="text-card text-ink">{t.price.masterTitle}</h3>
                <p className="mt-1 text-body text-ink">
                  {t.price.masterPrice} <Money tiyn={money.priceTiyn} /> — {t.price.masterGets}{" "}
                  <Money tiyn={money.payoutTiyn} />
                </p>
                <p className="mt-1 text-body text-muted">{t.price.masterNote}</p>
              </Card>
            </Section>
            <Section id={ABOUT_ANCHORS.refusal} title={t.refusal.title}>
              <Paragraphs items={t.refusal.paragraphs} />
            </Section>
            <Section id={ABOUT_ANCHORS.master} title={t.master.title}>
              <Paragraphs items={t.master.paragraphs} />
              {canBecomeMaster && (
                <div>
                  {/* -ml-6: текст тихой кнопки — по левой линии карточек. */}
                  <ButtonLink href={loginHref("executor")} variant="quiet" className="-ml-6">
                    {t.master.action}
                  </ButtonLink>
                </div>
              )}
            </Section>
          </Stack>
        }
        aside={device === "desktop" ? aside : null}
      />
      {device === "mobile" && action && (
        <ActionDock>
          <ButtonLink href={action.href}>{action.label}</ButtonLink>
        </ActionDock>
      )}
    </Stack>
  );
}
