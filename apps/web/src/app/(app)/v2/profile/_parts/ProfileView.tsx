import { ru } from "@/i18n/ru";
import { Card, Disclosure, DisclosureList, EmptyState, List, ListRow, Money, PageTitle, Section, Split, Stack, Stat, StatRow, StatusChip } from "@/kit";
import type { Theme } from "@/kit/theme";
import type { Device } from "@/platform/device";
import { LogoutButton } from "../../../_shell/LogoutButton";
import { LogoutEverywhere } from "../../../_shell/LogoutEverywhere";
import { ThemeSwitch } from "../../../_shell/ThemeSwitch";
import type { ProfileModel } from "./profile-view";

const t = ru.app.profile;

/**
 * Профиль — корневой экран вкладки: кто вошёл (имя, телефон; роль — когда их две), разделы списком со шевроном,
 * «Оформление» с переключателем темы на месте, смена роли (если есть что менять) и тихая «Выйти» внизу. Главного действия
 * на экране нет. Телефон — одна колонка: «Стать мастером» / «Переключиться на…» — последними строками списка разделов
 * (отдельный раздел ради одной строки не нужен). Компьютер — две колонки: слева человек и разделы, справа оформление,
 * «Роль» и выход.
 */
export function ProfileView({ model, theme, device }: { model: ProfileModel; theme: Theme; device: Device }) {
  const who = (
    <Card>
      <p className="text-headline wrap-anywhere text-ink">{model.name}</p>
      <p className="mt-1 text-body text-muted tabular-nums">{model.phone}</p>
      {model.roleLine && <p className="text-body text-muted">{model.roleLine}</p>}
    </Card>
  );
  const work = model.work.length > 0 && (
    <Section title={ru.app.masterProfile.sectionsTitle}>
      <nav aria-label={ru.app.masterProfile.sectionsLabel}>
        <Card padded={false}>
          <List>
            {model.work.map((row) => (
              <ListRow key={row.href} label={row.label} href={row.href} />
            ))}
          </List>
        </Card>
      </nav>
    </Section>
  );
  const h = t.history;
  const stats = model.history && (
    <StatRow label={h.statsLabel} inline>
      {model.history.stats.map((s) => (
        <Stat key={s.label} label={s.label} value={s.value} muted={s.value === 0} />
      ))}
    </StatRow>
  );
  const history = model.history && (
    <Section title={h.title}>
      {model.history.rows.length === 0 ? (
        <EmptyState title={h.empty.title} body={h.empty.body} />
      ) : (
        <Card padded={false}>
          <List>
            {model.history.rows.map((row) => (
              <ListRow
                key={row.id}
                label={row.title}
                href={row.href}
                {...(row.status ? { value: <StatusChip tone={row.status.tone}>{row.status.text}</StatusChip> } : {})}
                detail={
                  <>
                    {row.executorLabel && `${row.executorLabel} · `}
                    {row.priceTiyn !== null && (
                      <>
                        <Money tiyn={row.priceTiyn} tone="inherit" /> ·{" "}
                      </>
                    )}
                    {row.date}
                  </>
                }
              />
            ))}
          </List>
        </Card>
      )}
    </Section>
  );
  const faq = model.history && (
    <Section title={h.faq.title} id="profile-faq">
      <DisclosureList labelledBy="profile-faq">
        <Disclosure title={h.faq.statuses.title}>
          {h.faq.statuses.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Disclosure>
      </DisclosureList>
    </Section>
  );
  // Телефон: смена роли — последними строками разделов; компьютер — отдельным разделом справа.
  const rows = device === "mobile" ? [...model.sections, ...model.roles] : model.sections;
  const sections = (
    <nav aria-label={t.sectionsLabel}>
      <Card padded={false}>
        <List>
          {rows.map((row) => (
            <ListRow key={row.href} label={row.label} href={row.href} />
          ))}
        </List>
      </Card>
    </nav>
  );
  const appearance = (
    <Section title={t.theme.title}>
      <Card>
        <ThemeSwitch current={theme} legend={t.theme.legend} legendHidden />
      </Card>
    </Section>
  );
  const role = model.roles.length > 0 && (
    <Section title={t.role.title}>
      <Card padded={false}>
        <List>
          {model.roles.map((row) => (
            <ListRow key={row.href} label={row.label} href={row.href} />
          ))}
        </List>
      </Card>
    </Section>
  );
  const logout = (
    <div className="flex flex-col items-start gap-2">
      <LogoutButton flush />
      <LogoutEverywhere device={device} />
    </div>
  );

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      {device === "desktop" ? (
        <Split
          main={
            <Stack gap="section">
              {who}
              {stats}
              {history}
              {work}
              {sections}
              {faq}
            </Stack>
          }
          aside={
            <Stack gap="section">
              {appearance}
              {role}
              {logout}
            </Stack>
          }
        />
      ) : (
        <>
          {who}
          {stats}
          {history}
          {work}
          {sections}
          {appearance}
          {faq}
          {logout}
        </>
      )}
    </Stack>
  );
}
