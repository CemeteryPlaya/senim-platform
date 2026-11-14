import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Money, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
import { computeDealMoney } from "@/modules/payments";
import { getDevice } from "@/platform/device";
import { userPastOnboarding } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { SUPPORT_HREF } from "../../_shell/support";
import { HELP_ANCHORS } from "./anchors";

const t = ru.app.profile.help;

export const metadata: Metadata = { title: t.metaTitle };

/** Цена в примере раздела «Сколько это стоит»: 200 000 ₸ в тиынах (как на «О сервисе»). Суммы считает `computeDealMoney`. */
const EXAMPLE_PRICE_TIYN = 200_000n * 100n;

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
 * «Помощь»: вопросы и ответы покупателя простыми разделами с якорями (без раскрывающихся блоков): как это работает, сколько
 * стоит, где деньги, если мебель не подошла, как отменить, контакты мастера, поддержка. Открыта и гостю, и вошедшему
 * (вошедший с непройденными первыми шагами уходит на шаг с возвратом сюда). Главного действия на экране нет; на компьютере
 * справа — оглавление.
 */
export default async function HelpPage() {
  const [, device] = await Promise.all([userPastOnboarding(to("/help")), getDevice()]);
  const money = computeDealMoney(EXAMPLE_PRICE_TIYN);
  const toc = [
    { id: HELP_ANCHORS.how, label: t.how.title },
    { id: HELP_ANCHORS.price, label: t.price.title },
    { id: HELP_ANCHORS.money, label: t.money.title },
    { id: HELP_ANCHORS.notFit, label: t.notFit.title },
    { id: HELP_ANCHORS.cancel, label: t.cancel.title },
    { id: HELP_ANCHORS.contacts, label: t.contacts.title },
    { id: HELP_ANCHORS.support, label: t.support.title },
  ];

  const aside = (
    <Section title={t.tocTitle}>
      <Card padded={false}>
        <List>
          {toc.map((item) => (
            // Якорь на этой же странице: без шеврона (он про переход на другой экран).
            <ListRow key={item.id} label={item.label} href={`${to("/help")}#${item.id}`} chevron={false} />
          ))}
        </List>
      </Card>
    </Section>
  );

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} back={{ href: to("/"), label: t.back }} />
      <Split
        stickyAside={device === "desktop"}
        main={
          <Stack gap="section">
            <Section id={HELP_ANCHORS.how} title={t.how.title}>
              <Card>
                <ol className="flex list-decimal flex-col gap-2 pl-6 text-body text-ink">
                  {t.how.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </Card>
            </Section>
            <Section id={HELP_ANCHORS.price} title={t.price.title}>
              <Card>
                <Stack>
                  <p className="text-body text-ink">{t.price.intro}</p>
                  <p className="text-body text-ink">
                    {t.price.example} <Money tiyn={money.priceTiyn} /> — {t.price.pays} <Money tiyn={money.buyerTotalTiyn} />
                  </p>
                </Stack>
              </Card>
            </Section>
            <Section id={HELP_ANCHORS.money} title={t.money.title}>
              <Paragraphs items={t.money.paragraphs} />
            </Section>
            <Section id={HELP_ANCHORS.notFit} title={t.notFit.title}>
              <Paragraphs items={t.notFit.paragraphs} />
            </Section>
            <Section id={HELP_ANCHORS.cancel} title={t.cancel.title}>
              <Paragraphs items={t.cancel.paragraphs} />
            </Section>
            <Section id={HELP_ANCHORS.contacts} title={t.contacts.title}>
              <Paragraphs items={t.contacts.paragraphs} />
            </Section>
            <Section id={HELP_ANCHORS.support} title={t.support.title}>
              <Card>
                <Stack gap="tight">
                  <p className="text-body text-ink">{t.support.body}</p>
                  <div>
                    <TextLink href={SUPPORT_HREF}>{t.support.action}</TextLink>
                  </div>
                </Stack>
              </Card>
            </Section>
          </Stack>
        }
        aside={device === "desktop" ? aside : null}
      />
    </Stack>
  );
}
