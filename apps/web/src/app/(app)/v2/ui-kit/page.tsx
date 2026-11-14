import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  BackLink,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Chips,
  CodeField,
  Columns,
  EmptyState,
  Explain,
  FilterList,
  FirstSteps,
  HelpBlock,
  List,
  ListRow,
  Money,
  Narrow,
  Notice,
  NowNext,
  PageTitle,
  Pagination,
  PhoneField,
  PhotoSlot,
  Progress,
  RadioCard,
  RadioGroup,
  Rating,
  Section,
  Select,
  Sidebar,
  Skeleton,
  Split,
  Stack,
  StatusChip,
  TextArea,
  TextField,
  TextLink,
  WizardHeader,
  WorkCard,
  type ButtonVariant,
  type PhotoRatio,
  type StatusTone,
} from "@/kit";
import { getTheme } from "@/kit/theme";
import { getDevice } from "@/platform/device";
import { env } from "@/platform/env";
import { brand } from "@/config/brand";
import { ThemeSwitch } from "../../_shell/ThemeSwitch";
import { to } from "../../_shell/paths";
import { BuyerKit } from "./BuyerKit";
import { FormSample } from "./FormSample";
import { MasterKit } from "./MasterKit";
import { OverlaySamples } from "./OverlaySamples";

const s = ru.app.kit.showcase;

/** Образец с подписью над ним. */
function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-muted">{label}</p>
      {children}
    </div>
  );
}

const CHIPS: readonly { tone: StatusTone; label: string }[] = [
  { tone: "accent", label: s.chips.accent },
  { tone: "neutral", label: s.chips.neutral },
  { tone: "warn", label: s.chips.warn },
  { tone: "danger", label: s.chips.danger },
];

const PHOTOS: readonly { ratio: PhotoRatio; label: string }[] = [
  { ratio: "4/3", label: s.photos.r43 },
  { ratio: "1/1", label: s.photos.r11 },
  { ratio: "16/9", label: s.photos.r169 },
];

/** Роли цвета: фон образца — утилита токена (полностью записанная, чтобы Tailwind её собрал). */
const ROLES: readonly { swatch: string; label: string }[] = [
  { swatch: "bg-canvas", label: s.colors.canvas },
  { swatch: "bg-surface", label: s.colors.surface },
  { swatch: "bg-raised", label: s.colors.raised },
  { swatch: "bg-ink", label: s.colors.ink },
  { swatch: "bg-muted", label: s.colors.muted },
  { swatch: "bg-line", label: s.colors.line },
  { swatch: "bg-line-strong", label: s.colors.lineStrong },
  { swatch: "bg-track", label: s.colors.track },
  { swatch: "bg-action", label: s.colors.action },
  { swatch: "bg-on-action", label: s.colors.onAction },
  { swatch: "bg-accent", label: s.colors.accent },
  { swatch: "bg-accent-soft", label: s.colors.accentSoft },
  { swatch: "bg-danger", label: s.colors.danger },
  { swatch: "bg-danger-soft", label: s.colors.dangerSoft },
  { swatch: "bg-warn", label: s.colors.warn },
  { swatch: "bg-warn-soft", label: s.colors.warnSoft },
  { swatch: "bg-focus", label: s.colors.focus },
  { swatch: "bg-scrim", label: s.colors.scrim },
];

function Swatches() {
  return (
    <Card>
      <ul className="grid grid-cols-1 gap-3 desktop:grid-cols-3">
        {ROLES.map(({ swatch, label }) => (
          <li key={swatch} className="flex items-center gap-3">
            <span aria-hidden className={`size-10 shrink-0 rounded-field border border-line-strong ${swatch}`} />
            <span className="min-w-0 text-sub text-ink">{label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const VARIANTS: readonly { variant: ButtonVariant; label: string }[] = [
  { variant: "primary", label: s.buttons.primary },
  { variant: "secondary", label: s.buttons.secondary },
  { variant: "quiet", label: s.buttons.quiet },
  { variant: "danger", label: s.buttons.danger },
];

const STATES = `${s.buttons.states.normal}, ${s.buttons.states.pending}, ${s.buttons.states.disabled}`;

/** Варианты кнопок карточками; на компьютере — две колонки. У главной размера sm нет (запрещён типом). */
function Buttons() {
  return (
    <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-2">
      {VARIANTS.map(({ variant, label }) => (
        <Card key={variant} className="flex flex-col gap-4">
          <Specimen label={`${s.buttons.sizeMd}: ${STATES}`}>
            <div className="flex flex-wrap gap-3">
              <Button variant={variant}>{label}</Button>
              <Button variant={variant} pending>
                {label}
              </Button>
              <Button variant={variant} disabled>
                {label}
              </Button>
            </div>
          </Specimen>
          {variant !== "primary" && (
            <Specimen label={`${s.buttons.sizeSm}: ${STATES}`}>
              <div className="flex flex-wrap gap-3">
                <Button variant={variant} size="sm">
                  {label}
                </Button>
                <Button variant={variant} size="sm" pending>
                  {label}
                </Button>
                <Button variant={variant} size="sm" disabled>
                  {label}
                </Button>
              </div>
            </Specimen>
          )}
          <Specimen label={s.buttons.full}>
            <Button variant={variant} full>
              {label}
            </Button>
          </Specimen>
        </Card>
      ))}
    </div>
  );
}

function Fields() {
  const f = s.fields;
  return (
    <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-3">
      <Card className="flex flex-col gap-4">
        <Specimen label={f.states.empty}>
          <TextField label={f.textLabel} name="empty" placeholder={f.textPlaceholder} />
        </Specimen>
        <Specimen label={f.states.filled}>
          <TextField label={f.textLabel} name="filled" defaultValue={f.textFilled} />
        </Specimen>
        <Specimen label={f.states.error}>
          <TextField label={f.textLabel} name="error" error={f.textError} />
        </Specimen>
        <Specimen label={f.states.disabled}>
          <TextField label={f.textLabel} name="disabled" defaultValue={f.textFilled} disabled />
        </Specimen>
      </Card>
      <Card className="flex flex-col gap-4">
        <Specimen label={f.states.empty}>
          <TextArea label={f.areaLabel} name="area-empty" placeholder={f.areaPlaceholder} />
        </Specimen>
        <Specimen label={f.states.filled}>
          <TextArea label={f.areaLabel} name="area-filled" defaultValue={f.areaFilled} />
        </Specimen>
        <Specimen label={f.states.error}>
          <TextArea label={f.areaLabel} name="area-error" error={f.areaError} />
        </Specimen>
        <Specimen label={f.states.disabled}>
          <TextArea label={f.areaLabel} name="area-disabled" defaultValue={f.areaFilled} disabled />
        </Specimen>
      </Card>
      <Card className="flex flex-col gap-4">
        <Specimen label={f.states.empty}>
          <SelectField name="select-empty" />
        </Specimen>
        <Specimen label={f.states.filled}>
          <SelectField name="select-filled" defaultValue={f.selectOptions[0]} />
        </Specimen>
        <Specimen label={f.states.error}>
          <SelectField name="select-error" error={f.selectError} />
        </Specimen>
        <Specimen label={f.states.disabled}>
          <SelectField name="select-disabled" defaultValue={f.selectOptions[0]} disabled />
        </Specimen>
      </Card>
    </div>
  );
}

function SelectField({
  name,
  defaultValue = "",
  error,
  disabled,
}: {
  name: string;
  defaultValue?: string;
  error?: string;
  disabled?: boolean;
}) {
  const f = s.fields;
  return (
    <Select label={f.selectLabel} name={name} defaultValue={defaultValue} error={error} disabled={disabled}>
      <option value="" disabled>
        {f.selectPlaceholder}
      </option>
      {f.selectOptions.map((city) => (
        <option key={city} value={city}>
          {city}
        </option>
      ))}
    </Select>
  );
}

function Choices() {
  const c = s.choices;
  return (
    <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-2">
      <Card className="flex flex-col gap-2">
        <h3 className="text-card text-ink">{c.checkboxes}</h3>
        <Checkbox label={c.unchecked} name="check-off" />
        <Checkbox label={c.checked} name="check-on" defaultChecked />
        <Checkbox label={c.disabled} name="check-disabled" disabled />
        <Checkbox label={c.disabledChecked} name="check-disabled-on" defaultChecked disabled />
        <Checkbox label={c.error} name="check-error" error={c.errorText} />
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className="text-card text-ink">{c.radios}</h3>
        <RadioGroup legend={c.groupLegend}>
          <RadioCard label={c.phone} name="contact" value="phone" defaultChecked />
          <RadioCard label={c.chat} name="contact" value="chat" />
          <RadioCard label={c.mail} name="contact" value="mail" disabled />
        </RadioGroup>
        <h3 className="text-card text-ink">{c.described}</h3>
        <RadioGroup legend={c.describedLegend}>
          <RadioCard label={c.sms} description={c.smsText} name="channel" value="sms" defaultChecked />
          <RadioCard label={c.call} description={c.callText} name="channel" value="call" />
        </RadioGroup>
        <RadioGroup legend={c.groupLegend} error={c.groupError}>
          <RadioCard label={c.phone} name="contact-error" value="phone" />
          <RadioCard label={c.chat} name="contact-error" value="chat" />
        </RadioGroup>
      </Card>
    </div>
  );
}

const CHIP_ITEMS = [
  { label: s.filters.all, active: false },
  { label: s.filters.kitchens, active: true },
  { label: s.filters.wardrobes, active: false },
  { label: s.filters.beds, active: false },
  { label: s.filters.tables, active: false },
  { label: s.filters.children, active: false },
  { label: s.filters.offices, active: false },
].map((item, index) => ({ ...item, href: to(`/v2/ui-kit?filter=${index}`) }));

const pageHref = (page: number): string => to(`/v2/ui-kit?page=${page}`);

/** Телефон, код и сообщения: что нужно экрану входа. */
function Entry() {
  const c = s.codes;
  return (
    <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-2">
      <Card className="flex flex-col gap-4">
        <Specimen label={s.notices.info}>
          <Notice tone="info" title={s.notices.infoTitle}>
            {s.notices.infoBody}
          </Notice>
        </Specimen>
        <Specimen label={s.notices.warn}>
          <Notice tone="warn" live>
            {s.notices.warnBody}
          </Notice>
        </Specimen>
        <Specimen label={s.notices.danger}>
          <Notice tone="danger" title={s.notices.dangerTitle}>
            {s.notices.dangerBody}
          </Notice>
        </Specimen>
      </Card>
      <Card className="flex flex-col gap-4">
        <Specimen label={c.phone}>
          <PhoneField label={c.phoneLabel} name="phone" />
        </Specimen>
        <Specimen label={c.code}>
          <CodeField label={c.codeLabel} name="code" defaultValue="123456" />
        </Specimen>
        <Specimen label={c.withError}>
          <CodeField label={c.codeLabel} name="code-error" error={c.codeError} />
        </Specimen>
      </Card>
    </div>
  );
}

/** Карточки работ и оценка; на компьютере — три колонки. */
function Works() {
  const w = s.works;
  return (
    <div className="grid grid-cols-1 items-start gap-stack-group desktop:grid-cols-3">
      <Specimen label={w.slotPhoto}>
        <WorkCard
          href={to("/")}
          title={w.title}
          meta={w.meta}
          byline={w.byline}
          priceFrom={122400000n}
          media="slot"
          photo={{ src: "/img/kitchen.svg", alt: w.photoAlt }}
        />
      </Specimen>
      <Specimen label={w.slotEmpty}>
        <WorkCard href={to("/")} title={w.title} meta={w.meta} priceFrom={85000000n} media="slot" />
      </Specimen>
      <Specimen label={w.compact}>
        <WorkCard href={to("/")} title={w.title} meta={w.meta} byline={w.byline} priceFrom={85000000n} />
      </Specimen>
      <Specimen label={w.compactNoPrice}>
        <WorkCard href={to("/")} title={w.title} meta={w.meta} />
      </Specimen>
      <Specimen label={w.rating}>
        <Rating value={4.8} count={12} />
      </Specimen>
      <Specimen label={w.noReviews}>
        <Rating value={null} count={0} />
      </Specimen>
    </div>
  );
}

/**
 * Витрина нужна только разработчикам: вне dev страницы нет.
 * `?missing=1` (только в dev) — настоящий notFound() под (app): образец страницы «не найдена» v2 для e2e и снимков.
 */
export default async function UiKit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (env().APP_ENV !== "dev") notFound();
  const [device, theme, search] = await Promise.all([getDevice(), getTheme(), searchParams]);
  if (search.missing === "1") notFound();

  return (
    <Stack gap="section">
      <PageTitle title={s.title} lead={s.lead} />

      <Section title={s.sections.colors}>
        <Swatches />
      </Section>

      <Section title={s.sections.typography}>
        <Narrow>
          <Card className="flex flex-col gap-4">
            <p className="text-title text-ink">{s.typography.title}</p>
            <p className="text-section text-ink">{s.typography.section}</p>
            <p className="text-card text-ink">{s.typography.card}</p>
            <p className="text-body text-ink">{s.typography.body}</p>
            <p className="text-sub text-muted">{s.typography.sub}</p>
            <p className="text-small text-muted">{s.typography.small}</p>
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.layout}>
        <Stack>
          <Split
            main={
              <Card>
                <p className="text-body text-ink">{s.layout.main}</p>
              </Card>
            }
            aside={
              <Card>
                <p className="text-body text-ink">{s.layout.aside}</p>
              </Card>
            }
          />
          <Narrow>
            <p className="text-sub text-muted">{s.layout.note}</p>
          </Narrow>
          <Specimen label={s.layout.sidebar}>
            <Sidebar
              device={device}
              aside={
                <Card>
                  <p className="text-sub text-ink">{s.layout.sidebarAside}</p>
                </Card>
              }
            >
              <Card>
                <p className="text-body text-ink">{s.layout.sidebarMain}</p>
              </Card>
            </Sidebar>
          </Specimen>
        </Stack>
      </Section>

      <Section title={s.sections.buttons}>
        <Buttons />
      </Section>

      <Section title={s.sections.links}>
        <Stack>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={to("/")}>{s.links.primary}</ButtonLink>
            <ButtonLink href={to("/")} variant="secondary">
              {s.links.secondary}
            </ButtonLink>
            <ButtonLink href={to("/")} variant="quiet">
              {s.links.quiet}
            </ButtonLink>
            <ButtonLink href={to("/")} variant="secondary" size="sm">
              {s.links.secondary}
            </ButtonLink>
          </div>
          <Specimen label={s.links.textLink}>
            <TextLink href={to("/")}>{s.links.textLinkLabel}</TextLink>
          </Specimen>
          <Specimen label={s.columns.note}>
            <Columns count={3}>
              {[s.columns.one, s.columns.two, s.columns.three].map((title) => (
                <Card key={title}>
                  <h3 className="text-card text-ink">{title}</h3>
                  <p className="mt-1 text-body text-muted">{s.columns.body}</p>
                </Card>
              ))}
            </Columns>
          </Specimen>
          <Specimen label={s.links.back}>
            <BackLink href={to("/")} label={s.links.backParent} />
          </Specimen>
        </Stack>
      </Section>

      <Section title={s.sections.fields}>
        <Fields />
      </Section>

      <Section title={s.sections.choices}>
        <Choices />
      </Section>

      <Section title={s.sections.notices}>
        <Entry />
      </Section>

      <Section title={s.sections.filters}>
        <Stack>
          <Specimen label={s.filters.chips}>
            <Chips items={CHIP_ITEMS} label={s.filters.label} />
          </Specimen>
          <Specimen label={s.filters.list}>
            <Narrow>
              <Card>
                <FilterList title={s.filters.listTitle} items={CHIP_ITEMS} />
              </Card>
            </Narrow>
          </Specimen>
          <Narrow>
            <Stack>
              <Specimen label={s.filters.middle}>
                <Pagination page={2} pageCount={5} hrefFor={pageHref} label={s.filters.pagesLabel} />
              </Specimen>
              <Specimen label={s.filters.first}>
                <Pagination page={1} pageCount={3} hrefFor={pageHref} label={s.filters.pagesLabel} />
              </Specimen>
            </Stack>
          </Narrow>
        </Stack>
      </Section>

      <Section title={s.sections.works}>
        <Works />
      </Section>

      <Section title={s.sections.cards}>
        <Narrow>
          <Stack>
            <Card>
              <h3 className="text-card text-ink">{s.cards.cardTitle}</h3>
              <p className="mt-1 text-sub text-muted">{s.cards.cardBody}</p>
            </Card>
            <Specimen label={s.cards.listValues}>
              <Card padded={false}>
                <List>
                  <ListRow label={s.cards.rowStatus} value={s.cards.rowStatusValue} />
                  <ListRow label={s.cards.rowDate} value={s.cards.rowDateValue} />
                </List>
              </Card>
            </Specimen>
            <Specimen label={s.cards.stacked}>
              <Card padded={false}>
                <List>
                  <ListRow label={s.cards.rowStacked} value={s.cards.rowStackedValue} stacked />
                </List>
              </Card>
            </Specimen>
            <Specimen label={s.cards.listLinks}>
              <Card padded={false}>
                <List>
                  <ListRow label={s.cards.rowAbout} href={to("/about")} />
                  <ListRow label={s.cards.rowRules} value={s.cards.rowDateValue} href={to("/about")} />
                </List>
              </Card>
            </Specimen>
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.chips}>
        <div className="flex flex-wrap gap-3">
          {CHIPS.map(({ tone, label }) => (
            <StatusChip key={tone} tone={tone}>
              {label}
            </StatusChip>
          ))}
        </div>
      </Section>

      <Section title={s.sections.progress}>
        <Narrow>
          <Card className="flex flex-col gap-4">
            <Specimen label={s.progress.zero}>
              <Progress value={0} max={4} label={s.progress.zero} />
            </Specimen>
            <Specimen label={s.progress.partial}>
              <Progress value={2} max={4} label={s.progress.partial} />
            </Specimen>
            <Specimen label={s.progress.full}>
              <Progress value={4} max={4} label={s.progress.full} />
            </Specimen>
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.money}>
        <Narrow>
          <Card padded={false}>
            <List>
              <ListRow label={s.money.zero} value={<Money tiyn={0n} />} />
              <ListRow label={s.money.tiyn} value={<Money tiyn={122400050n} />} />
              <ListRow label={s.money.negative} value={<Money tiyn={-4500000n} />} />
              <ListRow label={s.money.large} value={<Money tiyn={1250000000000n} />} />
            </List>
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.photos}>
        <div className="grid grid-cols-1 gap-stack-group desktop:grid-cols-3">
          {PHOTOS.map(({ ratio, label }) => (
            <Specimen key={ratio} label={label}>
              <PhotoSlot ratio={ratio} alt={s.photos.alt} />
            </Specimen>
          ))}
        </div>
      </Section>

      <Section title={s.sections.skeleton}>
        <Narrow>
          <Card className="flex flex-col gap-4">
            <Specimen label={s.skeleton.lines}>
              <Skeleton />
            </Specimen>
            <Specimen label={s.skeleton.one}>
              <Skeleton lines={1} />
            </Specimen>
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.guidance}>
        <Split
          main={
            <Stack>
              <NowNext now={{ title: s.guidance.nowTitle, body: s.guidance.nowBody }} next={s.guidance.next} />
              <FirstSteps
                steps={[
                  { label: s.guidance.stepOne, done: true },
                  { label: s.guidance.stepTwo, done: false, href: to("/") },
                  { label: s.guidance.stepThree, done: false, href: to("/") },
                ]}
              />
              <EmptyState
                title={s.guidance.emptyTitle}
                body={s.guidance.emptyBody}
                action={{ href: to("/"), label: s.guidance.emptyAction }}
              />
            </Stack>
          }
          aside={
            <HelpBlock
              items={[
                { question: s.guidance.helpOne, href: to("/about") },
                { question: s.guidance.helpTwo, href: to("/about") },
              ]}
              supportEmail={brand.support.email}
            />
          }
        />
      </Section>

      <Section title={s.sections.wizard}>
        {/* Заголовок образца — второго уровня: заголовок первого уровня на странице уже есть (PageTitle). */}
        <Narrow>
          <Stack gap="tight">
            <Card>
              <WizardHeader
                step={2}
                total={5}
                title={s.wizard.title}
                headingLevel={2}
                back={{ href: to("/"), label: s.links.backParent }}
              />
            </Card>
            <p className="text-sub text-muted">{s.wizard.note}</p>
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.explain}>
        <Narrow>
          <Card>
            <p className="text-body text-ink">
              <Explain label={s.explain.label} title={s.explain.title} device={device}>
                {s.explain.body}
              </Explain>
            </p>
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.overlays}>
        <OverlaySamples device={device} />
      </Section>

      <Section title={s.sections.form}>
        <Narrow>
          <Stack>
            <p className="text-sub text-muted">{s.formSample.note}</p>
            <Card>
              <FormSample />
            </Card>
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.dock}>
        <Narrow>
          <Stack>
            <p className="text-sub text-muted">{s.dock.note}</p>
            <Card className="flex flex-col gap-4">
              <p className="text-body text-ink">{s.dock.filler}</p>
              <p className="text-body text-ink">{s.dock.filler}</p>
              <p className="text-body text-ink">{s.dock.filler}</p>
              <p className="text-body text-ink">{s.dock.filler}</p>
            </Card>
            <ActionDock>
              <Button>{s.dock.primary}</Button>
              <Button variant="quiet">{s.dock.quiet}</Button>
            </ActionDock>
          </Stack>
        </Narrow>
      </Section>

      <BuyerKit device={device} />
      <MasterKit />

      <Section title={s.sections.theme}>
        {/* Без карточки: переключатель стоит на фоне страницы, как в профиле — сегменты шире. */}
        <Narrow>
          <ThemeSwitch current={theme} />
        </Narrow>
      </Section>
    </Stack>
  );
}
