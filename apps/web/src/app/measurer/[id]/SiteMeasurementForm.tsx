"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { completeSiteMeasurementSchema, LIMITS } from "@/modules/requests/client";
import { Button, ConfirmDialog, DetailColumns, FormError, Input, Textarea } from "@/ui";
import { Uploader } from "@/app/_components/uploader";
import { useRunAction } from "@/app/requests/_parts/ActionButton";
import { completeSiteMeasurementAction } from "@/app/_components/pre-contract/actions";

const t = ru.requests.pre.measurer;
const toCm = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/**
 * Экран замера с формой результата: ширина, высота, глубина, заметки и фото. Форма охватывает DetailColumns, чтобы
 * единственная кнопка шага в StickyAction (на телефоне — у нижнего края) её отправляла; aside — что в заявке и адрес.
 * Отправка необратима (заявка откроется исполнителям) — поэтому с подтверждением. Пока фото загружаются, отправить нельзя.
 */
export function SiteMeasurementForm({ siteMeasurementId, aside }: { siteMeasurementId: string; aside: ReactNode }) {
  const [size, setSize] = useState({ w: "", h: "", d: "" });
  const [notes, setNotes] = useState("");
  const [photoFileIds, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending, error } = useRunAction(completeSiteMeasurementAction);

  const input = () => ({ siteMeasurementId, widthCm: toCm(size.w), heightCm: toCm(size.h), depthCm: toCm(size.d), notes, photoFileIds });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = completeSiteMeasurementSchema.safeParse(input());
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setConfirming(true);
  };
  const confirm = () => {
    const parsed = completeSiteMeasurementSchema.safeParse(input());
    if (parsed.success) void run(parsed.data).then(() => setConfirming(false));
  };

  return (
    <form noValidate onSubmit={onSubmit}>
      <DetailColumns
        aside={aside}
        main={
          <section aria-labelledby="site-result" className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="site-result" className="text-xl font-bold text-ink">
              {t.formTitle}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-4">
              <Input label={t.width} inputMode="numeric" value={size.w} onChange={(e) => setSize({ ...size, w: e.target.value })} error={errors.widthCm} />
              <Input label={t.height} inputMode="numeric" value={size.h} onChange={(e) => setSize({ ...size, h: e.target.value })} error={errors.heightCm} />
              <Input label={t.depth} optional inputMode="numeric" value={size.d} onChange={(e) => setSize({ ...size, d: e.target.value })} error={errors.depthCm} />
            </div>
            <Textarea label={t.notes} hint={t.notesHint} optional value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} error={errors.notes} />
            <Uploader purpose="REQUEST_ROOM" label={t.photos} max={LIMITS.photos} onChange={setPhotos} onBusyChange={setBusy} />
            <FormError message={error} />
          </section>
        }
        action={
          <Button type="submit" disabled={busy} loading={pending} fullWidth>
            {t.submit}
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        onCancel={() => !pending && setConfirming(false)}
        onConfirm={confirm}
        loading={pending}
        title={t.submitConfirmTitle}
        description={t.submitConfirmText}
        confirmLabel={t.submitConfirm}
        cancelLabel={ru.common.actions.cancel}
        tone="primary"
      >
        <FormError message={error} />
      </ConfirmDialog>
    </form>
  );
}
