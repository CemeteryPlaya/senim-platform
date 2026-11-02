import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { getOwnPayout, requireUserPage } from "@/modules/identity";
import { Container, Fact, PageHeader } from "@/ui";
import { PayoutForm } from "./PayoutForm";

const t = ru.identity.payout;

export const metadata: Metadata = { title: t.title };

/** Счёт мастера для выплаты (решение 2.2.8): на экране — только последние 4 символа IBAN. */
export default async function PayoutPage() {
  const user = await requireUserPage("/executor/profile/payout", "EXECUTOR");
  const { last4 } = await getOwnPayout(user);
  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.intro} back={{ href: "/executor/profile" }} />
      <dl>
        <Fact label={t.iban}>
          <span className="tabular-nums">{last4 ? t.current(last4) : t.none}</span>
        </Fact>
      </dl>
      <PayoutForm />
    </Container>
  );
}
