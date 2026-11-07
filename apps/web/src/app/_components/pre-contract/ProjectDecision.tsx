"use client";

import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { requestProjectChangesSchema } from "@/modules/requests/client";
import { Button, FormError, Textarea } from "@/ui";
import { ActionButton, useRunAction } from "@/app/requests/_parts/ActionButton";
import { approveProjectAction, requestProjectChangesAction } from "./actions";

const t = ru.requests.pre.project;

/**
 * Решение заказчика по проекту: «Утвердить проект» — главное действие; «Внести изменения» раскрывает поле комментария.
 * afterContract — сценарий «договор до замера»: утверждение фиксирует цену в пределах допуска.
 */
export function ProjectDecision({ projectId, afterContract }: { projectId: string; afterContract: boolean }) {
  const [changing, setChanging] = useState(false);
  const [comment, setComment] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const { run, pending, error } = useRunAction(requestProjectChangesAction);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = requestProjectChangesSchema.safeParse({ projectId, comment });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    void run(parsed.data);
  };

  if (changing) {
    return (
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <Textarea label={t.changesComment} hint={t.changesHint} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} error={fieldError} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending}>
            {t.sendChanges}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setChanging(false)}>
            {ru.common.actions.cancel}
          </Button>
        </div>
        <FormError message={error} />
      </form>
    );
  }
  // Как в макете 8: «Внести изменения» и «Утвердить проект» рядом, главное действие — справа (на телефоне — ниже).
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <Button variant="secondary" fullWidth onClick={() => setChanging(true)}>
        {t.changes}
      </Button>
      <ActionButton
        action={approveProjectAction}
        input={{ projectId }}
        fullWidth
        confirm={{
          title: t.approveConfirmTitle,
          text: afterContract ? t.approveConfirmTextAfterContract : t.approveConfirmText,
          yes: t.approve,
          no: ru.common.actions.cancel,
          tone: "primary",
        }}
      >
        {t.approve}
      </ActionButton>
    </div>
  );
}
