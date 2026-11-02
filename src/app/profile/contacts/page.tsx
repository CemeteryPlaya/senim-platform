import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { formatPhone, getOwnContacts, INSTAGRAM_MAX, requireUserPage } from "@/modules/identity";
import { Container, Fact, PageHeader } from "@/ui";
import { ContactsForm } from "./ContactsForm";

const t = ru.identity.contacts;

export const metadata: Metadata = { title: t.title };

/**
 * Контакты профиля заказчика и мастера: телефон входа и Instagram (ТЗ п. 3). Другая сторона сделки видит их
 * только после заключения оферты — об этом подсказка над формой.
 */
export default async function ContactsPage() {
  const user = await requireUserPage("/profile/contacts", "CLIENT", "EXECUTOR");
  const contacts = await getOwnContacts(user);
  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.hint} back={{ href: "/profile" }} />
      <dl>
        <Fact label={t.phone}>
          <span className="tabular-nums">{formatPhone(contacts.phone)}</span>
        </Fact>
      </dl>
      <ContactsForm initial={contacts.instagram ?? ""} max={INSTAGRAM_MAX} />
    </Container>
  );
}
