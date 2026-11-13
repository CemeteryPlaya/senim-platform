import { ru } from "@/i18n/ru";
import { TextField, type FieldProps } from "./fields";

export type PhoneFieldProps = FieldProps & { defaultValue?: string };

/** Поле телефона: клавиатура набора номера, автозаполнение `tel`, подсказка формата («+7 …») из `ru`. Серверный компонент. */
export function PhoneField({ defaultValue, ...field }: PhoneFieldProps) {
  return (
    <TextField
      {...field}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={ru.app.kit.fields.phonePlaceholder}
      defaultValue={defaultValue}
    />
  );
}
