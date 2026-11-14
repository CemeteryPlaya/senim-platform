import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Explain, List, ListRow, NowNext, PageTitle, Section, Split, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../../_shell/paths";
import type { LegalForm } from "./_parts/schema";
import { guestLoginHref, stepHref } from "./_parts/steps";

const t = ru.app.masterRegister;
const s = t.status;

/** То, что экрану статуса нужно от регистрации (`getMyRegistration`): номер — только последние 4 цифры. */
export type RegistrationView = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  legalForm: LegalForm;
  legalName: string;
  binIinLast4: string;
  rejectReason: string | null;
};

/** Анкета, как её получил сервис: форма работы, наименование, ИИН или БИН — 4 цифры. */
function Summary({ registration }: { registration: RegistrationView }) {
  return (
    <Section title={s.summaryTitle}>
      <Card padded={false}>
        <List>
          <ListRow label={s.form} value={t.form.legalForms[registration.legalForm]} />
          <ListRow label={s.legalName} value={registration.legalName} stacked />
          <ListRow label={s.binIin} value={s.masked(registration.binIinLast4)} />
        </List>
      </Card>
    </Section>
  );
}

/** На проверке: что проверяем и что можно сделать, пока ждёте (документы, счёт, портфолио). Главного действия нет. */
function Pending({ registration, device }: { registration: RegistrationView; device: Device }) {
  const p = s.pending;
  return (
    <Split
      main={
        <Stack gap="section">
          <Stack>
            <NowNext now={{ title: p.now, body: p.body }} next={p.next} />
            {/* Кнопка пояснения встаёт по левой линии текста. */}
            <div>
              <Explain label={t.form.explain.label} title={t.form.explain.title} device={device}>
                <p>{t.form.explain.body}</p>
              </Explain>
            </div>
          </Stack>
          <Section title={p.meanwhileTitle}>
            <Card padded={false}>
              <List>
                <ListRow label={p.documents} href={to("/executor/profile/kyc")} />
                <ListRow label={p.payout} href={to("/executor/profile/payout")} />
                <ListRow label={p.portfolio} href={to("/executor/portfolio")} />
              </List>
            </Card>
          </Section>
        </Stack>
      }
      aside={
        <Stack gap="section">
          <Section title={p.checksTitle}>
            <Card>
              <ul className="flex list-disc flex-col gap-2 pl-6 text-body text-ink">
                {p.checks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          </Section>
          <Summary registration={registration} />
        </Stack>
      }
    />
  );
}

/**
 * Статус регистрации мастера — дом мастера до одобрения: на проверке, одобрено (к заявкам), отказ (причина и «Исправить и
 * отправить заново» — та же анкета с первого шага). Вложенным экраном не является: «Назад» нет. Номер — только 4 цифры.
 */
export function RegisterStatus({ registration, device }: { registration: RegistrationView; device: Device }) {
  if (registration.status === "PENDING") {
    return (
      <Stack gap="section">
        <PageTitle title={s.title} />
        <Pending registration={registration} device={device} />
      </Stack>
    );
  }
  const approved = registration.status === "APPROVED";
  const now = approved
    ? { title: s.approved.now, body: s.approved.body }
    : { title: s.rejected.now, body: registration.rejectReason ? s.rejected.reason(registration.rejectReason) : s.rejected.noReason };
  return (
    <Stack gap="section">
      <PageTitle title={s.title} />
      <Split main={<NowNext now={now} next={approved ? s.approved.next : s.rejected.next} />} aside={<Summary registration={registration} />} />
      <ActionDock>
        {approved ? (
          <ButtonLink href={to("/executor/requests")}>{s.approved.action}</ButtonLink>
        ) : (
          <ButtonLink href={stepHref("form")}>{s.rejected.action}</ButtonLink>
        )}
      </ActionDock>
    </Stack>
  );
}

/** Гость: что нужно для регистрации и вход с выбранной ролью мастера и возвратом сюда. */
export function RegisterGuest() {
  const g = t.guest;
  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <PageTitle title={g.title} back={{ href: to("/"), label: t.backHome }} lead={g.lead} />
        <Section title={g.stepsTitle}>
          <Card>
            <ol className="flex flex-col gap-4">
              {g.steps.map((step, index) => (
                <li key={step}>
                  <p className="text-small text-muted">{g.stepLabel(index + 1)}</p>
                  <p className="mt-1 text-body text-ink">{step}</p>
                </li>
              ))}
            </ol>
          </Card>
        </Section>
        <ActionDock>
          <ButtonLink href={guestLoginHref()}>{g.action}</ButtonLink>
        </ActionDock>
      </Stack>
    </div>
  );
}
