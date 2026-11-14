import type { ReactNode } from "react";
import { Card, List, ListRow, PageTitle, Section, Split, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../../_shell/paths";

export type HelpToc = { id: string; label: string };

/** Абзацы ответа в карточке. */
export function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <Card>
      <Stack>
        {items.map((text) => (
          <p key={text} className="text-body text-ink">
            {text}
          </p>
        ))}
      </Stack>
    </Card>
  );
}

/**
 * Каркас «Помощи»: заголовок с «Назад», оглавление (на компьютере справа, на телефоне сверху перед первой секцией) и
 * секции с якорями. Общий для покупателя и мастера; тексты и секции приходят снизу.
 */
export function HelpFrame({
  title,
  lead,
  back,
  tocTitle,
  toc,
  device,
  children,
}: {
  title: string;
  lead: string;
  back: string;
  tocTitle: string;
  toc: readonly HelpToc[];
  device: Device;
  children: ReactNode;
}) {
  const contents = (
    <Section title={tocTitle}>
      <Card padded={false}>
        <List>
          {toc.map((item) => (
            // Якорь на этой же странице: без шеврона (он про переход на другой экран).
            <ListRow key={item.id} label={item.label} href={`${to("/help")}#${item.id}`} chevron={false} />
          ))}
        </List>
      </Card>
    </Section>
  );
  return (
    <Stack gap="section">
      <PageTitle title={title} lead={lead} back={{ href: to("/"), label: back }} />
      <Split
        stickyAside={device === "desktop"}
        main={
          <Stack gap="section">
            {device === "mobile" && contents}
            {children}
          </Stack>
        }
        aside={device === "desktop" ? contents : null}
      />
    </Stack>
  );
}
