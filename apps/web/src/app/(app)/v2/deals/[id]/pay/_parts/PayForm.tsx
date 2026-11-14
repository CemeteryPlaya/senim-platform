"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { ActionDock, Button, Card, Checkbox, cn, HiddenField, Section, Stack, toast } from "@/kit";
import type { ActionResult } from "@/platform/action";
import { FormError } from "../../../../../_shell/FormError";
import { useActionForm } from "../../../../../_shell/form";
import { isScrolledToEnd } from "../../../../consent/ConsentForm";
import { giveBankConsentAction, payAction, type PayOutcome } from "../actions";

const t = ru.app.deal.pay;
const PAY_FORM = "pay-form";
const CONSENT_FORM = "bank-consent-form";

export type PayFormProps = {
  dealId: string;
  /** Карточка сделки: туда — после оплаты, с тостом. */
  dealHref: string;
  /** «Оплатить 102 000 ₸»: сумма — итог сметы модуля, уже строкой. */
  payLabel: string;
  /** Своё согласие на передачу данных банку по этой сделке уже дано (`bankConsentState().mine`). */
  consentGiven: boolean;
  /** Текст согласия — `consentDocument("BANK_TRANSFER")`: его редакцию сервер сверяет с текущей. */
  document: ConsentDocument;
  /** Мастер своё согласие дал (`bankConsentState().other`): иначе оплата закрыта, главного действия нет. */
  masterReady: boolean;
};

/** Ответ CONFLICT (сделку или текст согласия изменили): экран перечитывается — ворота уведут, если платить уже не нужно. */
function refreshOnConflict<T>(result: ActionResult<T>, refresh: () => void): ActionResult<T> {
  if (!result.ok && result.code === "CONFLICT") refresh();
  return result;
}

/** Текст согласия в карточке со своей прокруткой: затухание у нижнего края и «Прокрутите…», пока не дочитан (как экран согласия). */
function ConsentText({ document: doc }: { document: ConsentDocument }) {
  const region = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const checkEnd = () => {
    if (region.current) setAtEnd(isScrolledToEnd(region.current));
  };
  useEffect(checkEnd, [doc.version]);
  return (
    <Card>
      <div data-end={atEnd} className="scroll-fade">
        <div ref={region} role="region" aria-label={t.consent.textLabel} tabIndex={0} onScroll={checkEnd} className="max-h-64 overflow-y-auto desktop:max-h-80">
          <Stack>
            <p className="text-sub text-muted">
              {t.consent.edition(doc.version)} · {doc.draft}
            </p>
            <p className="text-card text-ink">{doc.title}</p>
            {doc.sections.map((section) => (
              <section key={section.heading} className="flex flex-col gap-1">
                <h3 className="text-card text-ink">{section.heading}</h3>
                <p className="text-body text-ink">{section.body}</p>
              </section>
            ))}
          </Stack>
        </div>
      </div>
      <p aria-hidden={atEnd} className={cn("mt-3 text-sub text-muted transition-opacity duration-100", atEnd && "opacity-0")}>
        {t.consent.scrollHint}
      </p>
    </Card>
  );
}

function ConsentGiven() {
  return (
    <Card>
      <Stack gap="tight">
        <p className="text-card text-ink">{t.consent.given}</p>
        <p className="text-body text-muted">{t.consent.givenBody}</p>
      </Stack>
    </Card>
  );
}

/**
 * Согласие для банка и оплата. Мастер согласие дал — форма оплаты: текст согласия, отметка (если своего ещё нет) и одно
 * главное действие «Оплатить N ₸» в `ActionDock`: одним нажатием сохраняет отметку и оплачивает. Пока отметки нет, кнопка
 * отключена, причина — видимым текстом рядом. Мастер не дал — главного действия нет; своё согласие можно дать заранее
 * второстепенной кнопкой (как в v1: отметка и оплата — раздельные действия модуля).
 * После оплаты: страница банка — переход по адресу модуля; иначе карточка сделки с тостом («ждём подтверждения банка» или
 * «деньги в банке под защитой»). Двойное нажатие — одна отправка, а повтор модуль сводит к той же операции.
 */
export function PayForm(props: PayFormProps) {
  return props.masterReady ? <PayStep {...props} /> : <AheadStep {...props} />;
}

function PayStep({ dealId, dealHref, payLabel, consentGiven, document: doc }: PayFormProps) {
  const router = useRouter();
  const reasonId = useId();
  const [agreed, setAgreed] = useState(false);
  const [leaving, setLeaving] = useState<"bank" | "deal" | null>(null);
  const form = useActionForm(async (input: Parameters<typeof payAction>[0]) => refreshOnConflict(await payAction(input), () => router.refresh()), {
    onSuccess: (data: PayOutcome) => {
      if (data.redirectUrl) {
        setLeaving("bank");
        window.location.assign(data.redirectUrl);
        return;
      }
      if (data.status === "FAILED") {
        toast.error(t.errors.failed);
        router.refresh();
        return;
      }
      setLeaving("deal");
      toast(t.done[data.status]);
      router.push(dealHref);
    },
  });
  const ready = consentGiven || agreed;
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (leaving || !ready) return event.preventDefault();
    form.onSubmit(event);
  };

  return (
    <>
      <Section title={t.consent.section}>
        {consentGiven ? (
          <ConsentGiven />
        ) : (
          <>
            <p className="text-body text-muted">{t.consent.lead}</p>
            <ConsentText document={doc} />
          </>
        )}
        <form key={doc.version} id={PAY_FORM} method="post" onSubmit={onSubmit} noValidate>
          <Stack>
            <HiddenField name="dealId" value={dealId} />
            {!consentGiven && (
              <>
                <HiddenField name="version" value={doc.version} />
                <Checkbox name="agreed" value="on" label={t.consent.agree} checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} error={form.fieldErrors.agreed} />
              </>
            )}
            {!ready && (
              <p id={reasonId} className="text-body text-ink">
                {t.disabledReason}
              </p>
            )}
            <FormError error={form.error} atField={Boolean(form.fieldErrors.agreed)} />
            {leaving === "bank" && (
              <p role="status" className="text-body text-muted">
                {t.redirecting}
              </p>
            )}
          </Stack>
        </form>
      </Section>
      <ActionDock>
        <Button type="submit" form={PAY_FORM} pending={form.pending || leaving !== null} disabled={!ready} aria-describedby={ready ? undefined : reasonId}>
          {payLabel}
        </Button>
      </ActionDock>
    </>
  );
}

function AheadStep({ dealId, consentGiven, document: doc }: PayFormProps) {
  const router = useRouter();
  const form = useActionForm(async (input: Parameters<typeof giveBankConsentAction>[0]) => refreshOnConflict(await giveBankConsentAction(input), () => router.refresh()), {
    onSuccess: () => {
      toast(t.consent.saved);
      router.refresh();
    },
  });
  return (
    <Section title={t.consent.section}>
      {consentGiven ? (
        <ConsentGiven />
      ) : (
        <>
          <p className="text-body text-muted">{t.consent.lead}</p>
          <ConsentText document={doc} />
          <form key={doc.version} id={CONSENT_FORM} method="post" onSubmit={form.onSubmit} noValidate>
            <Stack>
              <HiddenField name="dealId" value={dealId} />
              <HiddenField name="version" value={doc.version} />
              <Checkbox name="agreed" value="on" label={t.consent.agree} error={form.fieldErrors.agreed} />
              <FormError error={form.error} atField={Boolean(form.fieldErrors.agreed)} />
              <div>
                <Button type="submit" variant="secondary" pending={form.pending}>
                  {t.consent.giveAhead}
                </Button>
              </div>
            </Stack>
          </form>
        </>
      )}
    </Section>
  );
}
