"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, IinField, PhoneField, Select, Stack, TextField } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { to } from "../../../../_shell/paths";
import { useOperatorForm } from "../../_parts/form";
import { addExecutorAction } from "../actions";

const q = ru.app.operatorQueues;
const f = q.executors.form;
const FORM = "add-executor-form";
const LEGAL_FORMS = ["SELF_EMPLOYED", "IP", "TOO"] as const;
const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const;
type LegalForm = (typeof LEGAL_FORMS)[number];

/**
 * Новый исполнитель вручную: телефон, форма, наименование, ИИН (самозанятый, ИП) или БИН (ТОО), подписант договора по
 * форме — владелец ИП или директор ТОО с ИИН (самозанятый подписывает сам, его ФИО — наименование), сегмент. Поля
 * подписанта меняются с формой. Номера — полями с маской и проверкой контрольной цифры до отправки. Главная кнопка — в
 * доке; после — карточка нового исполнителя.
 */
export function AddExecutorForm() {
  const router = useRouter();
  const [legalForm, setLegalForm] = useState<LegalForm>("SELF_EMPLOYED");
  const form = useOperatorForm(addExecutorAction, {
    onSuccess: ({ profileId }) => router.push(to(`/operator/executors/${encodeURIComponent(profileId)}`)),
  });
  const err = form.fieldErrors;
  return (
    <>
      <form id={FORM} onSubmit={form.onSubmit} noValidate>
        <Stack>
          <PhoneField label={f.phone} name="phone" error={err.phone} />
          <Select
            label={f.legalForm}
            name="legalForm"
            required
            value={legalForm}
            onChange={(event) => setLegalForm(event.currentTarget.value as LegalForm)}
            error={err.legalForm}
          >
            {LEGAL_FORMS.map((value) => (
              <option key={value} value={value}>
                {q.legalForms[value]}
              </option>
            ))}
          </Select>
          <TextField
            label={legalForm === "SELF_EMPLOYED" ? f.selfEmployedName : f.legalName}
            name="legalName"
            required
            maxLength={200}
            autoComplete="off"
            error={err.legalName}
          />
          <IinField key={legalForm === "TOO" ? "bin" : "iin"} kind={legalForm === "TOO" ? "bin" : "iin"} label={legalForm === "TOO" ? f.bin : f.iin} name="binIin" error={err.binIin} />
          {legalForm === "IP" && <TextField label={f.ownerName} name="ownerName" required maxLength={200} autoComplete="off" error={err.ownerName} />}
          {legalForm === "TOO" && (
            <>
              <TextField label={f.directorName} name="directorName" required maxLength={200} autoComplete="off" error={err.directorName} />
              <IinField label={f.directorIin} name="directorIin" error={err.directorIin} />
            </>
          )}
          {legalForm !== "SELF_EMPLOYED" && <p className="text-sub text-muted">{f.signerNote}</p>}
          <Select label={f.segment} name="segment" required defaultValue="COMFORT" error={err.segment}>
            {SEGMENTS.map((value) => (
              <option key={value} value={value}>
                {q.segments[value]}
              </option>
            ))}
          </Select>
          <FormError error={form.error} atField={Object.keys(err).length > 0} />
        </Stack>
      </form>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {f.submit}
        </Button>
      </ActionDock>
    </>
  );
}
