/**
 * Скрытое поле формы — единственный разрешённый способ передать значение вместе с формой (токен возврата, ключ
 * идемпотентности, `next`). Сырой `<input>` в экранах запрещён сторожем (правило 5), поэтому он живёт здесь.
 * Серверный компонент.
 */
export function HiddenField({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
