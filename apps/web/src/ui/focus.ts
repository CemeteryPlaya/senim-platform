/**
 * Фокус на первое поле с ошибкой (aria-invalid="true" ставят Input, Select, Textarea, Checkbox, RadioCards;
 * PhotoUpload — data-invalid: у role="group" нет aria-invalid). У группы (fieldset или role="group") фокус получает
 * выбранный вариант, а если выбора нет — первый доступный элемент управления внутри. Возвращает false, если
 * сфокусировать нечего: тогда вызывающий фокусирует сводку ошибок.
 */
export function focusFirstInvalid(root: ParentNode): boolean {
  const invalid = root.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]');
  if (!invalid) return false;
  const target = isGroup(invalid)
    ? (invalid.querySelector<HTMLElement>("input:checked:not(:disabled)") ?? invalid.querySelector<HTMLElement>(CONTROL))
    : invalid;
  if (!target) return false;
  target.focus();
  return true;
}

const CONTROL = "input:not(:disabled):not([type=hidden]):not([hidden]), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)";

const isGroup = (el: HTMLElement) => el.tagName === "FIELDSET" || el.getAttribute("role") === "group";
