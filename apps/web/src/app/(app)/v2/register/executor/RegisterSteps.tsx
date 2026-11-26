import { ru } from "@/i18n/ru";
import { Card, CityField, Explain, IinField, List, ListRow, Notice, RadioCard, RadioGroup, Section, Stack, TextField } from "@/kit";
import { SUGGESTED_CITIES } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { LEGAL_FORMS, type AnswerField, type Answers } from "./_parts/schema";
import { stepHref, summaryRows } from "./_parts/steps";

// Поля шагов анкеты мастера — только вид: значения, ошибки и изменения приходят пропсами от RegisterWizard. Постоянных
// подсказок под полями нет; ошибка — сразу у поля.

const t = ru.app.masterRegister;

export type StepErrors = Partial<Record<AnswerField, string>>;

type FieldsProps = {
  answers: Answers;
  errors: StepErrors;
  onChange: (field: AnswerField, value: string) => void;
};

/** Текстовое поле анкеты: значение и ошибка — из анкеты по имени. */
function Field({
  name,
  label,
  answers,
  errors,
  onChange,
  ...rest
}: FieldsProps & { name: AnswerField; label: string; inputMode?: "numeric"; autoComplete: string; maxLength: number }) {
  return (
    <TextField
      label={label}
      name={name}
      value={answers[name]}
      error={errors[name]}
      onChange={(event) => onChange(name, event.target.value)}
      {...rest}
    />
  );
}

/** Шаг 1: как вы работаете — самозанятый, ИП или ТОО (вопрос задан заголовком шага, у группы он же — имя для диктора). */
export function FormFields({ answers, errors, onChange }: FieldsProps) {
  return (
    <RadioGroup legend={t.steps.form} legendHidden error={errors.legalForm}>
      {LEGAL_FORMS.map((form) => (
        <RadioCard
          key={form}
          name="legalForm"
          value={form}
          label={t.form.legalForms[form]}
          {...(form === "SELF_EMPLOYED" ? { description: t.form.descriptions.SELF_EMPLOYED } : {})}
          checked={answers.legalForm === form}
          onChange={() => onChange("legalForm", form)}
        />
      ))}
    </RadioGroup>
  );
}

/**
 * Шаг 2: наименование и подписант по форме работы. Самозанятый — ФИО; ИП — наименование и владелец; ТОО — наименование,
 * БИН, директор и его ИИН. У самозанятого и ИП номер — ИИН из знакомства: только последние 4 цифры, ввести его нельзя; отказ
 * сервиса по этому номеру — плашкой под ним.
 */
export function NameFields({ answers, errors, onChange, ownIinLast4 }: FieldsProps & { ownIinLast4: string | null }) {
  const form = answers.legalForm === "" ? "SELF_EMPLOYED" : answers.legalForm;
  const props = { answers, errors, onChange };
  return (
    <Stack gap="section">
      <Field {...props} name="legalName" label={t.name.legalName[form]} autoComplete={form === "SELF_EMPLOYED" ? "name" : "organization"} maxLength={200} />
      {form === "TOO" ? (
        <IinField label={t.name.bin} name="binIin" kind="bin" defaultValue={answers.binIin} error={errors.binIin} onValueChange={(digits) => onChange("binIin", digits)} />
      ) : (
        <Stack gap="tight">
          {ownIinLast4 !== null && (
            <Card padded={false}>
              <List>
                <ListRow label={t.name.ownIin} value={t.check.masked(ownIinLast4)} />
              </List>
            </Card>
          )}
          {errors.binIin && (
            <Notice tone="danger" live>
              {errors.binIin}
            </Notice>
          )}
        </Stack>
      )}
      {form === "IP" && (
        <Section title={t.name.owner.title}>
          <Field {...props} name="ownerName" label={t.name.owner.name} autoComplete="name" maxLength={120} />
        </Section>
      )}
      {form === "TOO" && (
        <Section title={t.name.director.title}>
          <p className="text-body text-muted">{t.name.director.lead}</p>
          <Stack gap="section">
            <Field {...props} name="directorName" label={t.name.director.name} autoComplete="off" maxLength={120} />
            <IinField label={t.name.director.iin} name="directorIin" kind="iin" defaultValue={answers.directorIin} error={errors.directorIin} onValueChange={(digits) => onChange("directorIin", digits)} />
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

/** Шаг 3: город, район и адрес мастерской (необязательно), опыт. */
export function PlaceFields(props: FieldsProps) {
  return (
    <Stack gap="section">
      <CityField label={t.place.city} name="city" suggestions={SUGGESTED_CITIES} value={props.answers.city} onChange={(city) => props.onChange("city", city)} maxLength={100} error={props.errors.city} />
      <Field {...props} name="district" label={t.place.district} autoComplete="address-level3" maxLength={100} />
      <Field {...props} name="streetAddress" label={t.place.street} autoComplete="street-address" maxLength={200} />
      <Field {...props} name="yearsExperience" label={t.place.experience} inputMode="numeric" autoComplete="off" maxLength={2} />
    </Stack>
  );
}

/** Шаг 4: сводка — каждая строка ведёт на свой шаг; номера — последние 4 цифры. */
export function CheckSummary({ answers, ownIinLast4 }: { answers: Answers; ownIinLast4: string | null }) {
  return (
    <Stack>
      <Card padded={false}>
        <List>
          {summaryRows(answers, ownIinLast4).map((row) => (
            <ListRow key={row.label} label={row.label} value={row.value} href={stepHref(row.step)} stacked />
          ))}
        </List>
      </Card>
      <p className="text-sub text-muted">{t.check.footnote}</p>
    </Stack>
  );
}

/** Пояснение шага: на первом — как проходит проверка, на втором — кто увидит данные. */
export function StepExplain({ kind, device }: { kind: "form" | "name"; device: Device }) {
  const e = t[kind].explain;
  return (
    // Кнопка пояснения встаёт по левой линии текста, а не по центру растянутой колонки.
    <div>
      <Explain label={e.label} title={e.title} device={device}>
        <p>{e.body}</p>
      </Explain>
    </div>
  );
}
