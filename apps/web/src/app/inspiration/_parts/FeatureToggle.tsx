"use client";

import { ActionButton } from "@/app/deals/_parts/ActionButton";
import { ru } from "@/i18n/ru";
import { setFeaturedAction } from "../actions";

const t = ru.companies.inspiration.operator;

/** Оператор отмечает работу «В подборку» Сенім. Обратимо — без подтверждения. */
export function FeatureToggle({ itemId, featured }: { itemId: string; featured: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-muted" aria-live="polite">
        {featured ? t.added : ""}
      </p>
      <ActionButton action={setFeaturedAction} input={{ itemId, featured: !featured }} variant={featured ? "secondary" : "primary"}>
        {featured ? t.remove : t.add}
      </ActionButton>
    </div>
  );
}
