import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { formatPhone, getOwnContacts, INSTAGRAM_MAX, requireUserPage } from "@/modules/identity";
import { Container, KeyValueList, PageHeader } from "@/ui";
import { ContactsForm } from "./ContactsForm";

const t = ru.identity.contacts;

export const metadata: Metadata = { title: t.title };

/**
 * Контакты профиля заказчика и мастера: телефон входа и Instagram (ТЗ п. 3) — другая сторона сделки видит их
 * только после заключения оферты (подсказка над формой); e-mail — для копии подписанного акта (ТЗ п. 7).
 */
export default async function ContactsPage() {
  const user = await requireUserPage("/profile/contacts", "CLIENT", "EXECUTOR");
  const contacts = await getOwnContacts(user);
  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.hint} back={{ href: "/profile" }} />
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <KeyValueList rows={[{ label: t.phone, value: <span className="tabular-nums">{formatPhone(contacts.phone)}</span> }]} />
        <ContactsForm initial={{ instagram: contacts.instagram ?? "", email: contacts.email ?? "" }} max={INSTAGRAM_MAX} />
      </div>
    </Container>
  );
}
