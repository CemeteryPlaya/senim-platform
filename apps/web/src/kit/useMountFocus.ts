"use client";

import { useEffect, type RefObject } from "react";

/**
 * Фокус в поле, когда оно появилось на экране (`enabled`): шаг входа открыт по ссылке — клавиатура и курсор уже в поле,
 * лишнее касание не нужно. Свой эффект, а не атрибут `autoFocus`: тот срабатывает не при гидратации страницы с сервера.
 */
export function useMountFocus(ref: RefObject<HTMLInputElement | null>, enabled: boolean | undefined): void {
  useEffect(() => {
    if (enabled) ref.current?.focus();
    // Только при появлении поля: смена пропса позже фокус не переносит.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
