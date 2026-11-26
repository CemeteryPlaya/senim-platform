import { ru } from "@/i18n/ru";
import { Card, Money, Section, Stack, TextLink } from "@/kit";
import { partyEstimate } from "@/modules/payments";
import type { Device } from "@/platform/device";
import { SUPPORT_HREF } from "../../../_shell/support";
import { MASTER_HELP_ANCHORS as A } from "../anchors";
import { HelpFrame, Paragraphs } from "./HelpFrame";

const t = ru.app.masterProfile.help;

/** Цена в примере: 200 000 ₸ в тиынах. Гарантию и «вы получите» считает `partyEstimate`, не экран. */
const EXAMPLE_PRICE_TIYN = 200_000n * 100n;

/**
 * «Помощь» мастера: как получать заявки, сколько стоит, когда придут деньги, спор, почему скрыты контакты, поддержка.
 * Только факты продукта. Главного действия на экране нет.
 */
export function MasterHelp({ device }: { device: Device }) {
  const estimate = partyEstimate("EXECUTOR", EXAMPLE_PRICE_TIYN);
  const toc = [
    { id: A.requests, label: t.requests.title },
    { id: A.price, label: t.price.title },
    { id: A.money, label: t.money.title },
    { id: A.dispute, label: t.dispute.title },
    { id: A.contacts, label: t.contacts.title },
    { id: A.support, label: t.support.tocLabel },
  ];
  return (
    <HelpFrame title={t.title} back={t.back} tocTitle={t.tocTitle} toc={toc} device={device}>
      <Section id={A.requests} title={t.requests.title}>
        <Paragraphs items={t.requests.paragraphs} />
      </Section>
      <Section id={A.price} title={t.price.title}>
        <Card>
          <Stack>
            <p className="text-body text-ink">{t.price.intro}</p>
            <p className="text-body text-ink">
              {t.price.example} <Money tiyn={estimate.priceTiyn} /> — {t.price.guarantee} <Money tiyn={estimate.extraTiyn} /> —{" "}
              {t.price.youGet} <Money tiyn={estimate.totalTiyn} />
            </p>
          </Stack>
        </Card>
      </Section>
      <Section id={A.money} title={t.money.title}>
        <Paragraphs items={t.money.paragraphs} />
      </Section>
      <Section id={A.dispute} title={t.dispute.title}>
        <Paragraphs items={t.dispute.paragraphs} />
      </Section>
      <Section id={A.contacts} title={t.contacts.title}>
        <Paragraphs items={t.contacts.paragraphs} />
      </Section>
      <Section id={A.support} title={t.support.title}>
        <Card>
          <TextLink href={SUPPORT_HREF}>{t.support.action}</TextLink>
        </Card>
      </Section>
    </HelpFrame>
  );
}
