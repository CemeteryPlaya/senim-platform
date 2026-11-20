"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Button, Card, Checkbox, HiddenField, KeyValueList, Narrow, Section, Select, Stack, TextArea, TextField, toast } from "@/kit";
import type { AdminFieldInfo, AdminRow } from "@/modules/admin";
import { useActionForm } from "../../../../../_shell/form";
import { FormError } from "../../../../../_shell/FormError";
import { changesFrom, displayValue, formValue, FROM, isCheckbox, TO } from "../../../_parts/values";
import { updateRecordAction } from "./actions";

const t = ru.app.admin.record;
const d = ru.app.admin.data;

/** Значение длиннее или в несколько строк — многострочное поле. */
const LONG_TEXT = 80;
const MAX_LENGTH = 10_000;

export type RecordFormProps = {
  model: string;
  id: string;
  /** Поля записи, как их отдал модуль: только видимые, с доступом. */
  fields: readonly AdminFieldInfo[];
  row: AdminRow;
};

function EditableField({ field, value, error }: { field: AdminFieldInfo; value: string | null; error: string | undefined }) {
  const name = `${TO}${field.name}`;
  const label = field.name;
  if (isCheckbox(field)) return <Checkbox label={label} name={name} value="true" defaultChecked={value === "true"} error={error} />;
  if (field.type === "Boolean" || field.enumValues) {
    const options = field.enumValues ?? ["true", "false"];
    const caption = (option: string) => (field.enumValues ? option : option === "true" ? d.yes : d.no);
    return (
      <Select label={label} name={name} defaultValue={value ?? ""} error={error}>
        {!field.required && <option value="">{t.optional}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {caption(option)}
          </option>
        ))}
      </Select>
    );
  }
  if (field.type === "Int") return <TextField label={label} name={name} inputMode="numeric" autoComplete="off" defaultValue={value ?? ""} error={error} />;
  if (field.type === "String" && value !== null && (value.length > LONG_TEXT || value.includes("\n"))) {
    return <TextArea label={label} name={name} maxLength={MAX_LENGTH} defaultValue={value} error={error} />;
  }
  return <TextField label={label} name={name} maxLength={MAX_LENGTH} autoComplete="off" defaultValue={value ?? ""} error={error} />;
}

/**
 * Карточка записи админки: редактируемые поля — полями kit по типу (строка, целое, флажок, список значений), прежнее
 * значение каждого — скрытым полем (`from.<поле>`: по нему модуль делает условное обновление — правка поверх чужой даст
 * CONFLICT, а не затрёт её); остальные поля — текстом. Одно главное действие — «Сохранить»; таблица только для чтения —
 * без формы и кнопки. После сохранения — тост и свежие данные экрана (новые прежние значения).
 */
export function RecordForm({ model, id, fields, row }: RecordFormProps) {
  const router = useRouter();
  const editable = fields.filter((f) => f.access === "editable");
  const readonly = fields.filter((f) => f.access !== "editable");
  const form = useActionForm(updateRecordAction, {
    toInput: (data) => ({ model, id, changes: changesFrom(data, fields) }),
    clears: (name) => (name.startsWith(TO) ? [name.slice(TO.length)] : []),
    onSuccess: (result) => {
      toast(result.changed > 0 ? t.saved : t.unchanged);
      router.refresh();
    },
  });
  const errorAtField = editable.some((f) => form.fieldErrors[f.name] === form.error);

  return (
    <Stack gap="section">
      {editable.length > 0 && (
        <Section title={t.edit}>
          {/* Форма на компьютере — не шире 560 px (Narrow, rules.md). */}
          <Narrow>
            <Card>
              <form onSubmit={form.onSubmit} noValidate>
                <Stack>
                  {editable.map((field) => {
                    const value = formValue(row[field.name]);
                    return (
                      <div key={field.name}>
                        {value !== null && <HiddenField name={`${FROM}${field.name}`} value={value} />}
                        <EditableField field={field} value={value} error={form.fieldErrors[field.name]} />
                      </div>
                    );
                  })}
                  <FormError error={form.error} atField={errorAtField} />
                  <div>
                    <Button type="submit" pending={form.pending}>
                      {t.save}
                    </Button>
                  </div>
                </Stack>
              </form>
            </Card>
          </Narrow>
        </Section>
      )}
      <Section title={t.fields}>
        {editable.length === 0 && <p className="text-body text-muted">{t.readonlyNote}</p>}
        <Card padded={false}>
          <KeyValueList items={readonly.map((f) => ({ label: f.name, value: displayValue(row[f.name]) }))} />
        </Card>
      </Section>
    </Stack>
  );
}
