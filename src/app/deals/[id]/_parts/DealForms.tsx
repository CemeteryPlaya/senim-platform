"use client";

import { useState } from "react";
import type { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { Alert, Button, RadioCards, Select, Textarea } from "@/ui";
import { useRunAction } from "../../_parts/useRunAction";
import { disputePositionAction, openDisputeAction, reviewAction } from "../actions";

const t = ru.deal;
const REASONS = Object.entries(t.dispute.reason).map(([value, label]) => ({ value, label }));
const RATINGS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: t.forms.ratingOption(n) }));

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert tone="danger" live="assertive">
      {message}
    </Alert>
  );
}

/** Открыть спор: причина и описание. Действие вторичное — экран прячет форму под раскрывающийся блок. */
export function OpenDisputeForm({ dealId }: { dealId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(openDisputeAction);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run({ dealId, reason: reason as DisputeReason, description, attachmentIds: [] });
      }}
    >
      <Select
        label={t.forms.disputeReason}
        name="reason"
        options={REASONS}
        placeholder={ru.common.ui.selectPlaceholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fieldErrors.reason?.[0]}
      />
      <Textarea
        label={t.forms.disputeDescription}
        hint={t.forms.disputeHint}
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={3000}
        rows={4}
        error={fieldErrors.description?.[0]}
      />
      <FormError message={error} />
      <Button type="submit" variant="secondary" fullWidth loading={pending}>
        {t.actions.openDispute}
      </Button>
    </form>
  );
}

export function DisputePositionForm({ disputeId }: { disputeId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(disputePositionAction);
  const [position, setPosition] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run({ disputeId, position });
      }}
    >
      <Textarea
        label={t.forms.positionLabel}
        hint={t.forms.disputeHint}
        name="position"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        maxLength={3000}
        rows={4}
        error={fieldErrors.position?.[0]}
      />
      <FormError message={error} />
      <Button type="submit" fullWidth loading={pending}>
        {t.actions.sendPosition}
      </Button>
    </form>
  );
}

export function ReviewForm({ dealId }: { dealId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(reviewAction);
  const [rating, setRating] = useState("5");
  const [text, setText] = useState("");
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run({ dealId, rating: Number(rating), text });
      }}
    >
      <RadioCards label={t.forms.ratingLabel} name="rating" options={RATINGS} value={rating} onChange={setRating} columns={3} error={fieldErrors.rating?.[0]} />
      <Textarea
        label={t.forms.reviewText}
        hint={t.forms.reviewHint}
        optional
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
      />
      <FormError message={error} />
      <Button type="submit" fullWidth loading={pending}>
        {t.actions.sendReview}
      </Button>
    </form>
  );
}
