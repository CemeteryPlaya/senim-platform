"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ActionDock, Button, Card, Stack, TextArea, toast } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { submitPositionAction } from "./actions";
import type { DealSide } from "../../../../_shell/side";
import { disputeTexts, TEXT_MAX, textValid } from "./dispute-view";

const FORM = "position-form";

/** Позиция стороны по открытому спору (тексты по стороне): одно поле и главное действие «Отправить позицию». */
export function PositionForm({ disputeId, side }: { disputeId: string; side: DealSide }) {
  const t = disputeTexts(side).open.positionForm;
  const router = useRouter();
  const [position, setPosition] = useState("");
  const [local, setLocal] = useState<string | undefined>();
  const form = useActionForm(submitPositionAction, {
    toInput: () => ({ disputeId, position }),
    onSuccess: () => {
      toast(t.sent);
      router.refresh();
    },
  });
  const error = local ?? form.fieldErrors.position;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!textValid(position)) {
      setLocal(t.tooShort);
      return;
    }
    setLocal(undefined);
    void form.submit(new FormData());
  }

  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack>
            <p className="text-sub text-muted">{t.lead}</p>
            <TextArea label={t.label} name="position" value={position} onChange={(event) => setPosition(event.target.value)} maxLength={TEXT_MAX} rows={5} {...(error ? { error } : {})} />
            <FormError error={form.error} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {t.submit}
        </Button>
      </ActionDock>
    </>
  );
}
