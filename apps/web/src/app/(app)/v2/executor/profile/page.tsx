import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ButtonLink, Card, Explain, List, ListRow, NowNext, PageTitle, Section, Split, Stack, TextLink } from "@/kit";
import { getOwnProfile, listFurnitureTypes } from "@/modules/companies";
import { getDevice, type Device } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireMaster } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { companyNow, initialValues, publicHref, sectionLinks, type CompanyProfile } from "./_parts/company-view";
import { CompanyForm } from "./CompanyForm";

const t = ru.app.masterCompany;
const REGISTER = to("/register/executor");

export const metadata: Metadata = { title: t.company.metaTitle };

/**
 * Карточка «Как вас видят покупатели»: до оферты — номер исполнителя, после — название для оферты; одно пояснение, что
 * скрыто (в том числе что видно из адреса и маска «О себе»). Город и район здесь не повторяются: они в полях адреса.
 */
function Seen({ profile, device }: { profile: CompanyProfile; device: Device }) {
  const s = t.company.seen;
  const publicPage = publicHref(profile);
  return (
    <Section title={s.title}>
      <Card padded={false}>
        <List>
          <ListRow label={s.as} value={profile.label} />
          <ListRow label={s.legalName} value={profile.legalName} stacked />
        </List>
      </Card>
      <div>
        <Explain label={s.explain.label} title={s.explain.title} device={device}>
          {s.explain.points.map((point) => (
            <p key={point} className="mb-2 last:mb-0">
              {point}
            </p>
          ))}
        </Explain>
      </div>
      {publicPage && <TextLink href={publicPage}>{s.publicProfile}</TextLink>}
    </Section>
  );
}

/** Разделы личного — только у неодобренного мастера (у одобренного они на экране «Профиль»). */
function Sections({ profile }: { profile: CompanyProfile }) {
  const links = sectionLinks(profile.status);
  if (links.length === 0) return null;
  return (
    <Section title={t.company.sections.title}>
      <nav aria-label={t.company.sections.title}>
        <Card padded={false}>
          <List>
            {links.map((row) => (
              <ListRow key={row.href} label={row.label} href={row.href} />
            ))}
          </List>
        </Card>
      </nav>
    </Section>
  );
}

function Now({ profile }: { profile: CompanyProfile }) {
  const now = companyNow(profile);
  return (
    <Stack gap="tight">
      <NowNext now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }} {...(now.next ? { next: now.next } : {})} />
      {now.fixHref && now.fixLabel && (
        <ButtonLink variant="quiet" href={now.fixHref}>
          {now.fixLabel}
        </ButtonLink>
      )}
    </Stack>
  );
}

/**
 * «Компания» мастера: как его видят покупатели, разделы личного (документы, счёт для оплаты, портфолио — только у
 * неодобренного: одобренный пришёл с «Профиля», где они стоят) и форма (о себе, опыт, что делает, условия замера, адрес). Открыта и мастеру на проверке, и после отказа — компанию можно
 * заполнять до одобрения; нет профиля мастера — на регистрацию (там анкета и статус). «Назад» — «Профиль» у одобренного
 * (у неодобренного «Компания» — корневая вкладка). Телефон — «Сейчас» → «Как вас видят» → разделы → форма с главным
 * действием в доке; компьютер — форма слева, остальное справа.
 */
export default async function CompanyPage() {
  const { user, status } = await requireMaster(to("/executor/profile"));
  if (status === "none") redirect(REGISTER);
  const [read, device] = await Promise.all([
    Promise.all([getOwnProfile(user), listFurnitureTypes()]).catch((e: unknown) => {
      // Модуль отказал (роль или профиль пропали между входом и открытием экрана): экран статуса — на регистрации.
      if (isAppError(e) && e.code === "FORBIDDEN") return null;
      throw e;
    }),
    getDevice(),
  ]);
  if (read === null) redirect(REGISTER);
  const [profile, types] = read;

  const title = <PageTitle title={t.company.title} {...(status === "approved" ? { back: { href: to("/profile"), label: t.shared.backProfile } } : {})} />;
  const form = <CompanyForm initial={initialValues(profile)} types={types.map(({ id, name }) => ({ id, name }))} device={device} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              <Now profile={profile} />
              <Stack>{form}</Stack>
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Seen profile={profile} device={device} />
              <Sections profile={profile} />
            </Stack>
          }
        />
      </Stack>
    );
  }
  // Док формы — последний ребёнок корневой колонки: на телефоне он залипает над панелью вкладок.
  return (
    <Stack gap="section">
      {title}
      <Now profile={profile} />
      <Seen profile={profile} device={device} />
      <Sections profile={profile} />
      {form}
    </Stack>
  );
}
