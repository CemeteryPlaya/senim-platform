import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, Section, TextLink } from "@/kit";
import { getDevice } from "@/platform/device";
import { userPastOnboarding } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { SUPPORT_HREF } from "../../_shell/support";
import { HELP_ANCHORS } from "./anchors";
import { HelpFrame, Paragraphs } from "./_parts/HelpFrame";
import { MasterHelp } from "./_parts/MasterHelp";

const t = ru.app.profile.help;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Помощь»: вопросы и ответы покупателя простыми разделами с якорями (без раскрывающихся блоков): как это работает, сколько
 * стоит (одной фразой: покупатель платит цену мастера, пример «200 000 = 200 000» ничего не добавлял), где деньги, если
 * мебель не подошла, как отменить, контакты мастера, поддержка (заголовок-вопрос и ссылка). Открыта и гостю, и вошедшему
 * (вошедший с непройденными первыми шагами уходит на шаг с возвратом сюда). Главного действия на экране нет; на компьютере
 * справа оглавление, на телефоне оно сверху.
 */
export default async function HelpPage() {
  const [user, device] = await Promise.all([userPastOnboarding(to("/help")), getDevice()]);
  // Мастер видит свои вопросы; покупатель, гость, оператор — вопросы покупателя (как раньше).
  if (user?.role === "EXECUTOR") return <MasterHelp device={device} />;
  const toc = [
    { id: HELP_ANCHORS.how, label: t.how.title },
    { id: HELP_ANCHORS.price, label: t.price.title },
    { id: HELP_ANCHORS.money, label: t.money.title },
    { id: HELP_ANCHORS.notFit, label: t.notFit.title },
    { id: HELP_ANCHORS.cancel, label: t.cancel.title },
    { id: HELP_ANCHORS.contacts, label: t.contacts.title },
    { id: HELP_ANCHORS.support, label: t.support.tocLabel },
  ];

  return (
    <HelpFrame title={t.title} back={t.back} tocTitle={t.tocTitle} toc={toc} device={device}>
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
          <p className="text-body text-ink">{t.price.intro}</p>
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
          <TextLink href={SUPPORT_HREF}>{t.support.action}</TextLink>
        </Card>
      </Section>
    </HelpFrame>
  );
}
