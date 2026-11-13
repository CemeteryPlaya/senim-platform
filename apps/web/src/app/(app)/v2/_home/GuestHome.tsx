import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Explain, HelpBlock, PageTitle, Section, Split, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { ABOUT_ANCHORS } from "../about/anchors";
import { loginHref } from "./links";

const t = ru.app.guest.home;

/** Два входа: покупатель — главное действие, мастер — тихая ссылка рядом. */
function Actions() {
  return (
    <>
      <ButtonLink href={loginHref("client")}>{t.clientAction}</ButtonLink>
      <ButtonLink href={loginHref("executor")} variant="quiet">
        {t.executorAction}
      </ButtonLink>
    </>
  );
}

/**
 * Главная гостя: обещание продукта, вход, три шага, где лежат деньги и «Помощь».
 *
 * Компьютер — два `Split` 1,5 : 1: слева заголовок и оба входа, справа «Где ваши деньги»; ниже слева три шага, справа «Помощь»
 * (так нет пустой дыры под коротким заголовком). Телефон — одна колонка: заголовок, шаги, деньги, «Помощь», а главное
 * действие в `ActionDock` в конце: он прилипает над панелью вкладок, кнопка под большим пальцем с первого экрана. Док в
 * разметке один, поэтому `data-primary-action` на странице один. Фотографий нет. Шаги — Card, не списки с кружками-номерами (правила: никаких цветных кружков).
 */
export function GuestHome({ device }: { device: Device }) {
  const helpItems = [
    { question: t.helpMoney, href: `${to("/about")}#${ABOUT_ANCHORS.money}` },
    { question: t.helpPrice, href: `${to("/about")}#${ABOUT_ANCHORS.price}` },
    { question: t.helpRefusal, href: `${to("/about")}#${ABOUT_ANCHORS.refusal}` },
  ];

  const title = <PageTitle title={t.title} lead={t.lead} />;
  const steps = (
    <Section title={t.stepsTitle}>
      {t.steps.map((step, index) => (
        <Card key={step.title} as="article">
          <p className="text-small text-muted">{t.stepLabel(index + 1)}</p>
          <h3 className="mt-1 text-card text-ink">{step.title}</h3>
          <p className="mt-1 text-body text-muted">{step.text}</p>
        </Card>
      ))}
    </Section>
  );
  const trust = (
    <Section title={t.trustTitle}>
      <Card>
        <Stack>
          <p className="text-body text-ink">{t.trustMoney}</p>
          <p className="text-body text-ink">{t.trustRefusal}</p>
          <p className="text-body">
            <Explain label={t.explainLabel} title={t.explainTitle} device={device}>
              <p>{t.explainBody}</p>
            </Explain>
          </p>
        </Stack>
      </Card>
    </Section>
  );
  const help = <HelpBlock items={helpItems} supportEmail={brand.support.email} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        <Split
          main={
            <Stack gap="section">
              {title}
              <ActionDock>
                <Actions />
              </ActionDock>
            </Stack>
          }
          aside={trust}
        />
        <Split main={steps} aside={help} />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      {steps}
      {trust}
      {help}
      <ActionDock>
        <Actions />
      </ActionDock>
    </Stack>
  );
}
