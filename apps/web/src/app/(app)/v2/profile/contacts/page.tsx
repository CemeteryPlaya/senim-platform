import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, Explain, Narrow, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { formatPhone, getOwnContacts } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { requireV2User } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { SUPPORT_HREF } from "../../../_shell/support";
import { emailStepHref } from "../../email/steps";
import { ContactsForm } from "./ContactsForm";
import { EmailChangedToast } from "./EmailChangedToast";

const t = ru.app.profile.contacts;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Контакты покупателя и мастера: телефон (только показ, номер меняет поддержка), почта (адрес и «подтверждена»; смена —
 * экран почты с кодом: прежний адрес действует, пока новый не подтверждён) и Instagram (необязательно). Телефон и
 * Instagram другая сторона сделки видит только после заключения оферты.
 */
export default async function ContactsPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireV2User(to("/profile/contacts"), "CLIENT", "EXECUTOR");
  const [contacts, device] = await Promise.all([getOwnContacts(user), getDevice()]);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: to("/profile"), label: t.back }} lead={t.lead} />
        <Stack>
          <Card>
            <p className="text-sub text-muted">{t.phone.label}</p>
            <p className="text-body text-ink tabular-nums">{formatPhone(contacts.phone)}</p>
            <Explain label={t.phone.explain.label} title={t.phone.explain.title} device={device}>
              <p>{t.phone.explain.body}</p>
              <p className="mt-2">
                <TextLink href={SUPPORT_HREF}>{t.phone.explain.support}</TextLink>
              </p>
            </Explain>
          </Card>
          <Card>
            <p className="text-sub text-muted">{t.email.label}</p>
            {contacts.email ? (
              <>
                <p className="text-body wrap-anywhere text-ink">{contacts.email}</p>
                <div className="mt-1">
                  <StatusChip tone="accent">{t.email.confirmed}</StatusChip>
                </div>
              </>
            ) : (
              <p className="text-body text-ink">{t.email.notSet}</p>
            )}
            <TextLink href={emailStepHref("address", null, true)}>{contacts.email ? t.email.change : t.email.add}</TextLink>
          </Card>
          <ContactsForm initial={contacts.instagram ?? ""} device={device} />
        </Stack>
        {params.email === "changed" && <EmailChangedToast href={to("/profile/contacts")} />}
      </Stack>
    </Narrow>
  );
}
