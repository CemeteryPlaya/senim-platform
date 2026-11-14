"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { ActionDock, Button, Checkbox, HiddenField, Section, Stack, toast } from "@/kit";
import { FormError } from "../../../../../../_shell/FormError";
import { useActionForm } from "../../../../../../_shell/form";
import { BankConsentText } from "../../../_parts/BankConsentText";
import { giveBankConsentAction } from "../actions";

const tc = ru.app.masterSteps.sign.consent;
const FORM = "bank-consent-form";

type Props = { dealId: string; dealHref: string; document: ConsentDocument };

/**
 * Оферта подписана, а своего согласия для банка у мастера нет (Ruling 7): текст согласия с прокруткой, отметка и единственное
 * действие «Дать согласие». Без отметки сервер отвечает ошибкой у неё. После — тост и карточка сделки. Двойное нажатие —
 * одна отправка; повтор модуль сводит к той же записи.
 */
export function ConsentStep({ dealId, dealHref, document: doc }: Props) {
  const router = useRouter();
  const form = useActionForm(giveBankConsentAction, {
    onSuccess: () => {
      toast(tc.saved);
      router.push(dealHref);
    },
  });
  return (
    <>
      <Section title={tc.section}>
        <p className="text-body text-muted">{tc.lead}</p>
        <BankConsentText document={doc} />
        <form key={doc.version} id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack>
            <HiddenField name="dealId" value={dealId} />
            <HiddenField name="version" value={doc.version} />
            <Checkbox name="agreed" value="on" label={tc.agree} {...(form.fieldErrors.agreed ? { error: form.fieldErrors.agreed } : {})} />
            <FormError error={form.error} atField={Boolean(form.fieldErrors.agreed)} />
          </Stack>
        </form>
      </Section>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {tc.give}
        </Button>
      </ActionDock>
    </>
  );
}
