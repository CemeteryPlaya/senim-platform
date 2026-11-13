import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Columns, Explain, HelpBlock, Narrow, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { ABOUT_ANCHORS } from "../about/anchors";
import { loginHref } from "./links";

const t = ru.app.guest.home;

/** Ссылка для мастера: тихая, вне панели действий (в панели телефона — одна главная кнопка). */
function ExecutorLink() {
  return <TextLink href={loginHref("executor")}>{t.executorLink}</TextLink>;
}

/**
 * Главная гостя: обещание продукта, вход, три шага, где лежат деньги и «Помощь».
 *
 * Компьютер — три ряда. 1: `Split` 1,5 : 1 — слева заголовок, подзаголовок, главная кнопка и ссылка для мастера, справа
 * «Где ваши деньги». 2: «Как это работает» на всю ширину тремя карточками в ряд. 3: «Помощь» в `Narrow`.
 * Телефон — одна колонка: заголовок, ссылка для мастера (виден на первом экране), шаги, деньги, «Помощь»; главная
 * кнопка — одна в `ActionDock` в конце, он прилипает над панелью вкладок. Док в разметке один, поэтому
 * `data-primary-action` на странице один. Фотографий нет.
 */
export function GuestHome({ device }: { device: Device }) {
  const helpItems = [
    { question: t.helpMoney, href: `${to("/about")}#${ABOUT_ANCHORS.money}` },
    { question: t.helpPrice, href: `${to("/about")}#${ABOUT_ANCHORS.price}` },
    { question: t.helpRefusal, href: `${to("/about")}#${ABOUT_ANCHORS.refusal}` },
  ];
  const primary = <ButtonLink href={loginHref("client")}>{t.clientAction}</ButtonLink>;
  const title = <PageTitle title={t.title} lead={t.lead} />;

  // Ряд карточек шагов: колонка на телефоне, три равные колонки на компьютере (`Columns`).
  const steps = (
    <Section title={t.stepsTitle}>
      <Columns count={3}>
        {t.steps.map((step, index) => (
          <Card key={step.title} as="article">
            <p className="text-small text-muted">{t.stepLabel(index + 1)}</p>
            <h3 className="mt-1 text-card text-ink">{step.title}</h3>
            <p className="mt-1 text-body text-ink">{step.text}</p>
          </Card>
        ))}
      </Columns>
    </Section>
  );
  const trust = (
    <Section title={t.trustTitle}>
      <Card>
        <Stack>
          {t.trustParagraphs.map((text) => (
            <p key={text} className="text-body text-ink">
              {text}
            </p>
          ))}
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
                {primary}
                <ExecutorLink />
              </ActionDock>
            </Stack>
          }
          aside={trust}
        />
        {steps}
        <Narrow>{help}</Narrow>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Stack gap="tight">
        {title}
        <div>
          <ExecutorLink />
        </div>
      </Stack>
      {steps}
      {trust}
      {help}
      <ActionDock>{primary}</ActionDock>
    </Stack>
  );
}
