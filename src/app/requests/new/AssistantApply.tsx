"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DescribeAssistant } from "@/app/_components/ai-assistant";
import type { RequestDraft } from "@/modules/ai/client";
import type { StepFormInput, WizardScreen } from "@/modules/requests/client";
import { saveStepAction } from "../actions";
import { FormError } from "../_parts/ActionButton";

type Props = {
  draftId: string;
  types: readonly { id: string; slug: string; name: string }[];
  /** Экран, на который вернуть заказчика после переноса — проверить перенесённое. */
  reviewScreen: WizardScreen;
};

/**
 * «Опишите своими словами» (ai-engineer) → поля черновика по экранам мастера.
 * Переносится только то, что заказчик подтвердил в помощнике; остальное он заполнит сам.
 */
export function AssistantApply({ draftId, types, reviewScreen }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (d: RequestDraft) =>
    startTransition(async () => {
      setError(null);
      const typeId = types.find((t) => t.slug === d.furnitureTypeSlug)?.id ?? null;
      const unknown = new Set(d.details.unknown ?? []);
      const steps: (StepFormInput | null)[] = [
        typeId || d.customType ? { screen: "type", furnitureTypeId: typeId, customType: typeId ? null : d.customType } : null,
        d.style ? { screen: "style", style: d.style, styleNote: "" } : null,
        d.details.widthCm
          ? { screen: "size", size: { mode: "known", widthCm: d.details.widthCm, heightCm: d.details.heightCm ?? null, depthCm: d.details.depthCm ?? null } }
          : unknown.has("size")
            ? { screen: "size", size: { mode: "unknown" } }
            : null,
        // Материал, который помощник не распознал, переносится как «не знаю» — заказчик проверит на экране.
        d.details.facade || d.details.countertop || d.details.hardware
          ? {
              screen: "materials",
              facade: d.details.facade ?? "unknown",
              countertop: d.details.countertop ?? "unknown",
              hardware: d.details.hardware ?? "unknown",
              color: d.details.color ?? "",
              extras: [],
              description: d.wishes,
            }
          : null,
      ];
      for (const step of steps) {
        if (!step) continue;
        const result = await saveStepAction({ requestId: draftId, step });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      router.push(`/requests/new?draft=${draftId}&step=${reviewScreen}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <DescribeAssistant requestId={draftId} furnitureTypes={types} onApply={apply} />
      <FormError message={error} />
    </div>
  );
}
