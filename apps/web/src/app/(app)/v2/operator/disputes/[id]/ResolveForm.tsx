"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card, ConfirmDialog, formatMoney, HiddenField, KeyValueList, Money, MoneyField, RadioCard, RadioGroup, Stack, TextArea, toast } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { outcomeOf } from "../../../../_shell/form";
import { useOperatorForm } from "../../_parts/form";
import { SecondFactorField } from "../../_parts/SecondFactorField";
import { previewSplitAction, resolveDisputeAction } from "../actions";
import { previewState, RESOLVED_PARAM, type Preview } from "./preview";

const t = ru.app.operatorDisputes;
const d = t.decision;

const OUTCOMES = ["CONTINUE", "FULL_REFUND", "PARTIAL_SPLIT"] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * Решение по спору (ADR-009, раздел 3): итог, сумма мастеру при разделе, обоснование (обязательно, до 2000 знаков).
 * Расчёт раздела считает сервер (`computeSplit`) — формулы в браузере нет; расчёт показывается, только пока сумма в поле
 * та, для которой он сделан. Решение просит код из приложения, если его вводили давно (поле кода появляется над кнопкой).
 * Повторное нажатие гасит форма, двойное решение — модуль. После решения экран обновляется: на месте формы — итог.
 */
export function ResolveForm({ disputeId, maxTiyn, buyerTotalTiyn, mobile }: { disputeId: string; maxTiyn: bigint; buyerTotalTiyn: bigint; mobile: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("CONTINUE");
  const [shareTiyn, setShareTiyn] = useState<bigint | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [calculating, startCalculation] = useTransition();
  const busy = useRef(false);
  /** Что оператор подтвердил в окне (итог и сумма мастеру): повтор с кодом без окна — только для этого же решения. */
  const confirmed = useRef<{ outcome: Outcome; shareTiyn: bigint | null } | null>(null);
  const form = useOperatorForm(resolveDisputeAction, {
    formRef,
    onSuccess: () => {
      toast(d.done);
      // Адрес с признаком «решено»: экран обновится, и итог примет фокус (форма, где он был, исчезнет).
      router.replace(`${pathname}?${RESOLVED_PARAM}=1`);
    },
  });

  const state = previewState(preview, shareTiyn);

  function calculate() {
    if (busy.current) return;
    if (shareTiyn === null) {
      setPreview(null);
      setPreviewError(d.shareRequired);
      return;
    }
    busy.current = true;
    startCalculation(async () => {
      try {
        const result = await previewSplitAction({ disputeId, masterShareKzt: (shareTiyn / 100n).toString() });
        const out = outcomeOf(result, { pathname: window.location.pathname, search: window.location.search });
        if (out.kind === "success") {
          setPreviewError(null);
          setPreview({
            shareTiyn: BigInt(out.data.shareTiyn),
            masterTiyn: BigInt(out.data.masterTiyn),
            platformTiyn: BigInt(out.data.platformTiyn),
            refundTiyn: BigInt(out.data.refundTiyn),
          });
        } else if (out.kind === "leave") {
          window.location.assign(out.href);
        } else {
          setPreview(null);
          setPreviewError(out.fieldErrors.masterShareKzt ?? out.error);
        }
      } finally {
        busy.current = false;
      }
    });
  }

  /** Возврат и раздел необратимы: перед отправкой — окно с итогом и суммами. Раздел — только по свежему расчёту. */
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Код из приложения уже просили после подтверждения — второе окно не нужно, но только если итог и сумма те же, а расчёт
    // раздела свежий: иначе (сменили итог или сумму, пока на экране поле кода) — снова расчёт и окно с суммами.
    const same = confirmed.current?.outcome === outcome && confirmed.current.shareTiyn === shareTiyn && (outcome !== "PARTIAL_SPLIT" || state === "fresh");
    if (outcome === "CONTINUE" || (form.needsCode && same)) return form.onSubmit(event);
    event.preventDefault();
    if (outcome === "PARTIAL_SPLIT" && state !== "fresh") {
      setPreviewError(shareTiyn === null ? d.shareRequired : d.previewFirst);
      return;
    }
    setConfirming(true);
  }

  const confirm = (() => {
    if (outcome === "FULL_REFUND") return { title: d.confirm.FULL_REFUND.title, body: d.confirm.FULL_REFUND.body(formatMoney(buyerTotalTiyn)), action: d.confirm.FULL_REFUND.action };
    if (outcome === "PARTIAL_SPLIT" && preview && state === "fresh") {
      const c = d.confirm.PARTIAL_SPLIT;
      return { title: c.title, body: c.body(formatMoney(preview.masterTiyn), formatMoney(preview.platformTiyn), formatMoney(preview.refundTiyn)), action: c.action };
    }
    return null;
  })();

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <Stack gap="section">
        <HiddenField name="disputeId" value={disputeId} />
        <RadioGroup legend={d.outcomeLegend} {...(form.fieldErrors.outcome ? { error: form.fieldErrors.outcome } : {})}>
          {OUTCOMES.map((key) => (
            <RadioCard
              key={key}
              name="outcome"
              value={key}
              label={t.disputes.outcomes[key]}
              description={d.outcomeHints[key]}
              checked={outcome === key}
              onChange={() => setOutcome(key)}
            />
          ))}
        </RadioGroup>
        {outcome === "PARTIAL_SPLIT" && (
          <Stack>
            <MoneyField
              label={d.shareLabel}
              name="masterShareKzt"
              onValueChange={setShareTiyn}
              under={<span className="text-sub text-muted">{d.shareHint(formatMoney(maxTiyn))}</span>}
              {...(form.fieldErrors.masterShareKzt || previewError ? { error: form.fieldErrors.masterShareKzt ?? previewError ?? "" } : {})}
            />
            <div aria-live="polite" className="flex flex-col gap-3">
              <Button type="button" variant="secondary" size="sm" pending={calculating} onClick={calculate} className="self-start">
                {d.previewButton}
              </Button>
              {state === "fresh" && preview ? (
                <Card padded={false}>
                  <KeyValueList
                    items={[
                      { label: d.previewMaster, value: <Money tiyn={preview.masterTiyn} /> },
                      { label: d.previewPlatform, value: <Money tiyn={preview.platformTiyn} /> },
                      { label: d.previewRefund, value: <Money tiyn={preview.refundTiyn} /> },
                    ]}
                  />
                </Card>
              ) : (
                <p className="text-sub text-muted">{state === "stale" ? d.previewStale : d.previewWaiting}</p>
              )}
            </div>
          </Stack>
        )}
        <Stack gap="tight">
          <TextArea label={d.rationaleLabel} name="rationale" required maxLength={2000} rows={5} {...(form.fieldErrors.rationale ? { error: form.fieldErrors.rationale } : {})} />
          <p className="text-sub text-muted">{d.rationaleHint}</p>
        </Stack>
        <FormError error={form.error} atField={Boolean(form.fieldErrors.rationale || form.fieldErrors.outcome || form.fieldErrors.masterShareKzt)} />
        <SecondFactorField form={form} />
        <Button type="submit" full={mobile} pending={form.pending}>
          {d.submit}
        </Button>
      </Stack>
      {confirm && (
        <ConfirmDialog
          device={mobile ? "mobile" : "desktop"}
          tone="danger"
          open={confirming}
          onOpenChange={setConfirming}
          title={confirm.title}
          description={confirm.body}
          confirmLabel={confirm.action}
          cancelLabel={d.confirm.cancel}
          onConfirm={async () => {
            confirmed.current = { outcome, shareTiyn };
            await form.submit(new FormData(formRef.current ?? undefined));
          }}
        />
      )}
    </form>
  );
}
