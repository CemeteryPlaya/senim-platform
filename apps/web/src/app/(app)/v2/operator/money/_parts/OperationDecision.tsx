"use client";

import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, HiddenField, Narrow, Stack, TextField } from "@/kit";
import type { ManualOperationType } from "@/modules/operator";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { formDataToInput } from "../../../../_shell/form";
import { useDecisionDone } from "../../_parts/decision";
import { useOperatorForm } from "../../_parts/form";
import { ReasonWindow } from "../../_parts/ReasonWindow";
import { SecondFactorField } from "../../_parts/SecondFactorField";
import { confirmBankOperationAction, failBankOperationAction, retryBankOperationAction } from "../actions";
import { ScanField } from "./ScanField";

const t = ru.app.operatorQueues.money;

type DecisionProps = {
  device: Device;
  transactionId: string;
  type: ManualOperationType;
  /** Сегодня по Астане (`YYYY-MM-DD`): дата документа по умолчанию и верхняя граница. */
  today: string;
};

/**
 * Подтверждение операции по документу банка: номер, дата, скан — и одна кнопка с тем, что сделал банк. Скан — файл в
 * состоянии формы (`ScanField`), уходит в действие вместе с полями. Действие с деньгами: сервер может попросить код из
 * приложения — поле кода появляется над кнопкой, следующая отправка проверяет код и повторяет подтверждение с тем же
 * сканом. Кнопка — вторичная: карточки очереди равноправны, главной кнопки на экране нет.
 */
function ConfirmForm({ transactionId, type, today }: Omit<DecisionProps, "device">) {
  const formRef = useRef<HTMLFormElement>(null);
  const done = useDecisionDone(formRef);
  const [scan, setScan] = useState<File | null>(null);
  const form = useOperatorForm(confirmBankOperationAction, {
    formRef,
    toInput: (data) => ({ ...formDataToInput(data), ...(scan ? { scan } : {}) }),
    // Ошибка сохранённого скана приходит у bankDocFileId (схема payments): снимается вместе с ошибкой поля скана.
    clears: (name) => (name === "scan" ? ["bankDocFileId"] : []),
    onSuccess: () => done(t.confirmed),
  });
  const scanError = form.fieldErrors.scan ?? form.fieldErrors.bankDocFileId;
  // Ошибка сервера у скана относится к прежнему выбору: выбор или удаление файла её прячет сразу — и при перетаскивании,
  // где события `input` (по нему форма снимает ошибку поля) нет. Новая отправка снова показывает ответ сервера.
  const [stale, setStale] = useState<string | null>(null);
  const pick = (file: File | null) => {
    setScan(file);
    setStale(scanError ?? null);
  };
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        setStale(null);
        form.onSubmit(event);
      }}
      noValidate
    >
      <Stack>
        <HiddenField name="transactionId" value={transactionId} />
        {/* Поля не шире 560 px на компьютере: карточка во всю ширину рабочего места, а номер и дата короткие. */}
        <Narrow>
          <Stack>
            <TextField label={t.bankDocNumber} name="bankDocNumber" required maxLength={100} autoComplete="off" error={form.fieldErrors.bankDocNumber} />
            <TextField label={t.bankDocDate} name="bankDocDate" type="date" required defaultValue={today} max={today} error={form.fieldErrors.bankDocDate} />
            <ScanField file={scan} onChange={pick} error={scanError === stale ? undefined : scanError} />
          </Stack>
        </Narrow>
        <FormError error={form.error} atField={Object.keys(form.fieldErrors).length > 0} />
        <SecondFactorField form={form} />
        <div>
          <Button type="submit" variant="secondary" pending={form.pending}>
            {t.confirm[type]}
          </Button>
        </div>
      </Stack>
    </form>
  );
}

/** Карточка ждущей операции: подтверждение по документу и тихая кнопка «Банк отклонил операцию» (окно с причиной). */
export function OperationDecision({ device, transactionId, type, today }: DecisionProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const done = useDecisionDone(anchor);
  return (
    <div ref={anchor} className="flex flex-col gap-stack-group">
      <ConfirmForm transactionId={transactionId} type={type} today={today} />
      <div>
        <ReasonWindow device={device} action={failBankOperationAction} fields={{ transactionId }} texts={t.fail} onDone={done} />
      </div>
    </div>
  );
}

/**
 * «Повторить операцию» у отклонённой банком: новая попытка с новым ключом; действие с деньгами — со свежим кодом.
 * Пока запрос идёт, кнопка в ожидании; повтор всё равно не создаст второй попытки (payments).
 */
export function RetryForm({ transactionId }: { transactionId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const done = useDecisionDone(formRef);
  const form = useOperatorForm(retryBankOperationAction, { formRef, onSuccess: () => done(t.retried) });
  return (
    <form ref={formRef} onSubmit={form.onSubmit} noValidate>
      <Stack>
        <HiddenField name="transactionId" value={transactionId} />
        <FormError error={form.error} />
        <SecondFactorField form={form} />
        <div>
          <Button type="submit" variant="secondary" pending={form.pending}>
            {t.retry}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
