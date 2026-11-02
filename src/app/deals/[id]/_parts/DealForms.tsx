"use client";

import { useState } from "react";
import type { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { Button, Checkbox, FormError, RadioCards, Select, Textarea } from "@/ui";
import { useRunAction } from "../../_parts/useRunAction";
import { disputePositionAction, openDisputeAction, reviewAction } from "../actions";

const t = ru.deal;
const d = t.dispute;
const REASONS = Object.entries(d.reason).map(([value, label]) => ({ value, label }));
const RATINGS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: t.review.ratingOption(n) }));

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
        run({ dealId, reason: reason as DisputeReason, description });
      }}
    >
      <Select
        label={d.reasonLabel}
        name="reason"
        options={REASONS}
        placeholder={ru.common.ui.selectPlaceholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fieldErrors.reason?.[0]}
      />
      <Textarea
        label={d.descriptionLabel}
        hint={d.hint}
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
        rows={4}
        error={fieldErrors.description?.[0]}
      />
      <FormError message={error} />
      <Button type="submit" variant="danger" fullWidth loading={pending}>
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
        label={d.positionLabel}
        hint={d.hint}
        name="position"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        maxLength={2000}
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

/** Отзыв — только при флаге reviews (действие показывает nextStep: leaveReview). */
export function ReviewForm({ dealId }: { dealId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(reviewAction);
  const [rating, setRating] = useState("5");
  const [text, setText] = useState("");
  const [portfolioConsent, setPortfolioConsent] = useState(false);
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run({ dealId, rating: Number(rating), text, portfolioConsent });
      }}
    >
      <RadioCards label={t.review.ratingLabel} name="rating" options={RATINGS} value={rating} onChange={setRating} columns={3} error={fieldErrors.rating?.[0]} />
      <Textarea
        label={t.review.textLabel}
        hint={t.review.textHint}
        optional
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
      />
      <Checkbox
        label={ru.companies.dealPortfolio.reviewConsent}
        hint={ru.companies.dealPortfolio.reviewConsentHint}
        checked={portfolioConsent}
        onChange={(e) => setPortfolioConsent(e.target.checked)}
      />
      <FormError message={error} />
      <Button type="submit" fullWidth loading={pending}>
        {t.actions.sendReview}
      </Button>
    </form>
  );
}
