import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, List, ListRow, PageTitle, Section, Split, Stack } from "@/kit";
import { to } from "../../_shell/paths";
import { loginHref } from "../_home/links";
import { ABOUT_ANCHORS } from "./anchors";

const t = ru.app.guest.about;

export const metadata: Metadata = { title: t.title };

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

/**
 * «О сервисе»: четыре раздела с якорями (деньги, цена по ролям, отказ от мебели, как стать мастером) и одно главное
 * действие в конце. Компьютер — `Split`: слева разделы, справа оглавление (на телефоне его нет: страница короткая, а
 * ссылки с главной ведут сразу к нужному разделу). Якоря и порядок — в `anchors.ts`.
 */
export default function AboutPage() {
  const toc = [
    { id: ABOUT_ANCHORS.money, label: t.money.title },
    { id: ABOUT_ANCHORS.price, label: t.price.title },
    { id: ABOUT_ANCHORS.refusal, label: t.refusal.title },
    { id: ABOUT_ANCHORS.master, label: t.master.title },
  ];

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} back={{ href: to("/"), label: t.backLabel }} />
      <Split
        main={
          <Stack gap="section">
            <Section id={ABOUT_ANCHORS.money} title={t.money.title}>
              <Paragraphs items={t.money.paragraphs} />
            </Section>
            <Section id={ABOUT_ANCHORS.price} title={t.price.title}>
              <Card as="article">
                <h3 className="text-card text-ink">{t.price.buyerTitle}</h3>
                <p className="mt-1 text-body text-ink">{t.price.buyerText}</p>
              </Card>
              <Card as="article">
                <h3 className="text-card text-ink">{t.price.masterTitle}</h3>
                <p className="mt-1 text-body text-ink">{t.price.masterText}</p>
              </Card>
            </Section>
            <Section id={ABOUT_ANCHORS.refusal} title={t.refusal.title}>
              <Paragraphs items={t.refusal.paragraphs} />
            </Section>
            <Section id={ABOUT_ANCHORS.master} title={t.master.title}>
              <Paragraphs items={t.master.paragraphs} />
              <div>
                <ButtonLink href={loginHref("executor")} variant="secondary">
                  {t.master.action}
                </ButtonLink>
              </div>
            </Section>
          </Stack>
        }
        aside={
          <div className="hidden desktop:block">
            <Section title={t.tocTitle}>
              <Card padded={false}>
                <List>
                  {toc.map((item) => (
                    <ListRow key={item.id} label={item.label} href={`${to("/about")}#${item.id}`} />
                  ))}
                </List>
              </Card>
            </Section>
          </div>
        }
      />
      <ActionDock>
        <ButtonLink href={loginHref("client")}>{t.clientAction}</ButtonLink>
      </ActionDock>
    </Stack>
  );
}
