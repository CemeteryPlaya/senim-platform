"use client";

import { ru } from "@/i18n/ru";
import { Checkbox, RadioCard, RadioGroup, Stack } from "@/kit";
import type { ShowcaseSignature } from "@/generated/prisma/enums";

/**
 * Выбор покупателя (как `ShowcaseView` модуля deal-core; тип модуля серверный, на клиент не тянем). Место — только «не
 * показывать» или «город» (ADR-016); прежние «город и район» и «город, район и ЖК» модуль отдаёт как город.
 */
export type ShowcaseChoice = { photos: boolean; price: boolean; address: "NONE" | "CITY"; signature: ShowcaseSignature };

const t = ru.app.deal.showcase;
const SIGNATURES = ["NAME", "INITIAL"] as const;

type Props = {
  value: ShowcaseChoice;
  onChange: (next: ShowcaseChoice) => void;
  /** Варианты места (`addressOptions` модуля): не показывать или город. */
  addressOptions: readonly ShowcaseChoice["address"][];
  /** Префикс имён полей: на экране отзыва рядом другие радио. */
  prefix?: string;
  addressError?: string;
};

/** Выбор показа: фото, стоимость (галочки), адрес и подпись (радио). Общий для страницы выбора и экрана отзыва. */
export function ShowcaseFields({ value, onChange, addressOptions, prefix = "", addressError }: Props) {
  return (
    <Stack gap="section">
      <Stack>
        <Checkbox label={t.photos} name={`${prefix}photos`} checked={value.photos} onChange={(event) => onChange({ ...value, photos: event.target.checked })} />
        <Checkbox label={t.price} name={`${prefix}price`} checked={value.price} onChange={(event) => onChange({ ...value, price: event.target.checked })} />
      </Stack>
      <RadioGroup legend={t.addressLegend} {...(addressError ? { error: addressError } : {})}>
        {addressOptions.map((option) => (
          <RadioCard key={option} name={`${prefix}address`} value={option} label={t.address[option] ?? option} checked={value.address === option} onChange={() => onChange({ ...value, address: option })} />
        ))}
      </RadioGroup>
      <RadioGroup legend={t.signatureLegend}>
        {SIGNATURES.map((option) => (
          <RadioCard key={option} name={`${prefix}signature`} value={option} label={t.signature[option] ?? option} checked={value.signature === option} onChange={() => onChange({ ...value, signature: option })} />
        ))}
      </RadioGroup>
    </Stack>
  );
}
