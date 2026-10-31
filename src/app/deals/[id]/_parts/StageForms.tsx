"use client";

import { useState } from "react";
import { Uploader } from "@/app/_components/uploader";
import { ru } from "@/i18n/ru";
import { Alert, Button, ConfirmDialog, Textarea } from "@/ui";
import { useRunAction } from "../../_parts/useRunAction";
import { acceptStageAction, reworkAction, submitStageAction } from "../actions";

const t = ru.deal;

/** Исполнитель сдаёт этап: отчёт и фото (загрузка — компонент files, наружу только id файлов). */
export function SubmitStageForm({ stageId }: { stageId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(submitStageAction);
  const [report, setReport] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  // Пока фото загружается, его id ещё нет в photoIds: отправка дала бы «Добавьте хотя бы одно фото».
  const [uploading, setUploading] = useState(false);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!uploading) run({ stageId, report, photoIds });
      }}
    >
      <Textarea
        label={t.forms.reportLabel}
        hint={t.forms.reportHint}
        name="report"
        value={report}
        onChange={(e) => setReport(e.target.value)}
        maxLength={2000}
        rows={4}
        error={fieldErrors.report?.[0]}
      />
      <Uploader
        purpose="STAGE_REPORT"
        label={t.forms.photosLabel}
        hint={t.forms.photosHint}
        max={12}
        onChange={setPhotoIds}
        onBusyChange={setUploading}
        error={fieldErrors.photoIds?.[0]}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Button type="submit" fullWidth loading={pending || uploading} aria-describedby={uploading ? "stage-photos-wait" : undefined}>
        {t.actions.submit}
      </Button>
      <p id="stage-photos-wait" className="text-base text-ink-soft" aria-live="polite">
        {uploading ? t.forms.waitPhotos : ""}
      </p>
    </form>
  );
}

/** Заказчик проверяет сданный этап: главное действие — принять; вторичное — вернуть с комментарием. */
export function ReviewStage({ stageId }: { stageId: string }) {
  const accept = useRunAction(acceptStageAction);
  const rework = useRunAction(reworkAction);
  const [showRework, setShowRework] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Button fullWidth loading={accept.pending} disabled={rework.pending} onClick={() => setAsking(true)}>
        {t.actions.accept}
      </Button>
      {/* Приёмка необратима: сначала подтверждение с последствиями. */}
      <ConfirmDialog
        open={asking}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          accept.run({ stageId });
        }}
        title={t.forms.acceptTitle}
        description={t.forms.acceptText}
        confirmLabel={t.forms.acceptConfirm}
        cancelLabel={ru.common.actions.notNow}
        tone="primary"
      />
      {accept.error && (
        <Alert tone="danger" live="assertive">
          {accept.error}
        </Alert>
      )}
      {!showRework ? (
        <Button variant="secondary" fullWidth onClick={() => setShowRework(true)}>
          {t.actions.rework}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            rework.run({ stageId, note });
          }}
        >
          <Textarea
            label={t.forms.reworkLabel}
            hint={t.forms.reworkHint}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={3}
            autoFocus
            error={rework.fieldErrors.note?.[0]}
          />
          {rework.error && (
            <Alert tone="danger" live="assertive">
              {rework.error}
            </Alert>
          )}
          <Button type="submit" variant="secondary" fullWidth loading={rework.pending}>
            {t.actions.rework}
          </Button>
        </form>
      )}
    </div>
  );
}
