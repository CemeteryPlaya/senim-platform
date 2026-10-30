/**
 * Фокус на первое поле с ошибкой (aria-invalid="true" ставят Input, Select, Textarea, Checkbox, RadioCards).
 * У группы вариантов (fieldset) фокус получает выбранный вариант, а если выбора нет — первый доступный.
 * Возвращает false, если сфокусировать нечего: тогда вызывающий фокусирует сводку ошибок.
 */
export function focusFirstInvalid(root: ParentNode): boolean {
  const invalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!invalid) return false;
  const target =
    invalid instanceof HTMLFieldSetElement
      ? (invalid.querySelector<HTMLElement>("input:checked:not(:disabled)") ?? invalid.querySelector<HTMLElement>("input:not(:disabled)"))
      : invalid;
  if (!target) return false;
  target.focus();
  return true;
}
