"use client";

import { useRouter } from "next/navigation";
import { toast } from "@/kit";
import type { ActionResult } from "@/platform/action";
import { outcomeOf } from "./form";

/**
 * Ответ действия, вызванного не формой (подтверждение в окне, пункт меню): успех — `onSuccess`; «сессия истекла» /
 * «нужно согласие» — уход на экран v2 с возвратом (`outcomeOf`); отказ — тост с текстом сервера и обновление экрана (цена
 * или состояние могли измениться).
 *
 * Возвращает, закрывать ли окно: по умолчанию — всегда `true` (после отказа содержимое окна устарело). С
 * `keepOpenOnError` при отказе возвращает `false`: окно подтверждения остаётся открытым (тост уже показан), при успехе и
 * уходе — закрывается (так у портфолио: удаление можно повторить).
 */
export function useSettle({ keepOpenOnError = false }: { keepOpenOnError?: boolean } = {}) {
  const router = useRouter();
  return <T,>(result: ActionResult<T>, onSuccess: (data: T) => void): boolean => {
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "success") onSuccess(outcome.data);
    else if (outcome.kind === "leave") window.location.assign(outcome.href);
    else {
      toast.error(outcome.error);
      router.refresh();
      return !keepOpenOnError;
    }
    return true;
  };
}
