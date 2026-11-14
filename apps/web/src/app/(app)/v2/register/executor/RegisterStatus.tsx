import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, List, ListRow, NowNext, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
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
          <ListRow label={registration.legalForm === "TOO" ? s.bin : s.iin} value={s.masked(registration.binIinLast4)} />
        </List>
      </Card>
    </Section>
  );
}

/** Состояние документов мастера (`getOwnKyc`); `null` — узнать не удалось. */
export type KycState = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

/** Документы ждут мастера: не поданы или отклонены — тогда «Загрузить документы» главное действие экрана. */
export const documentsWanted = (kyc: KycState | null): boolean => kyc === "NOT_SUBMITTED" || kyc === "REJECTED";

const KYC_HREF = to("/executor/profile/kyc");

/** «Ваши сделки»: у мастера до одобрения вкладки «Сделки» нет, а сделки есть (одобрение сняли или оно ещё не пришло). */
function DealsLink() {
  return <TextLink href={to("/deals")}>{ru.app.masterDeal.list.yours}</TextLink>;
}

/**
 * На проверке: что проверяем и что можно сделать, пока ждёте. Документы не поданы или отклонены — главное действие
 * «Загрузить документы» (в доке); поданы или проверены — строка с их состоянием, главного действия нет. Счёт и
 * портфолио — строками.
 */
function Pending({ registration, kyc }: { registration: RegistrationView; kyc: KycState | null }) {
  const p = s.pending;
  const documentsRow =
    kyc === "PENDING" || kyc === "VERIFIED" ? (
      <ListRow label={p.documentsRow} value={p.documentsState[kyc]} href={KYC_HREF} />
    ) : kyc === null ? (
      <ListRow label={p.documents} href={KYC_HREF} />
    ) : null;
  return (
    <Split
      main={
        <Stack gap="section">
          <NowNext now={{ title: p.now, body: p.body }} next={p.next} />
          <Section title={p.meanwhileTitle}>
            <Card padded={false}>
              <List>
                {documentsRow}
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
 * отправить заново» — та же анкета с первого шага). Вложенным экраном не является: «Назад» нет. Номер — только 4 цифры. `hasDeals` — у мастера есть сделки: под
 * «Сейчас» ссылка «Ваши сделки» (до одобрения вкладки «Сделки» нет).
 */
export function RegisterStatus({ registration, kyc = null, hasDeals = false }: { registration: RegistrationView; kyc?: KycState | null; hasDeals?: boolean }) {
  if (registration.status === "PENDING") {
    return (
      <Stack gap="section">
        <PageTitle title={s.title} />
        <Pending registration={registration} kyc={kyc} />
        {hasDeals && <DealsLink />}
        {documentsWanted(kyc) && (
          <ActionDock>
            <ButtonLink href={KYC_HREF}>{s.pending.documents}</ButtonLink>
          </ActionDock>
        )}
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
      {hasDeals && !approved && <DealsLink />}
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
