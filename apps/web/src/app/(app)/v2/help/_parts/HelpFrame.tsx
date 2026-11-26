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
 * Каркас «Помощи»: заголовок с «Назад» (без подзаголовка: экран говорит сам), оглавление (на компьютере справа под
 * заголовком «Вопросы», на телефоне сверху перед первой секцией — заголовок только для диктора: список вопросов называет
 * себя сам) и секции с якорями. Общий для покупателя и мастера; тексты и секции приходят снизу.
 */
export function HelpFrame({
  title,
  back,
  tocTitle,
  toc,
  device,
  children,
}: {
  title: string;
  back: string;
  tocTitle: string;
  toc: readonly HelpToc[];
  device: Device;
  children: ReactNode;
}) {
  const list = (
    <Card padded={false}>
      <List>
        {toc.map((item) => (
          // Якорь на этой же странице: без шеврона (он про переход на другой экран).
          <ListRow key={item.id} label={item.label} href={`${to("/help")}#${item.id}`} chevron={false} />
        ))}
      </List>
    </Card>
  );
  const contents =
    device === "desktop" ? (
      <Section title={tocTitle}>{list}</Section>
    ) : (
      <section>
        <h2 className="sr-only">{tocTitle}</h2>
        {list}
      </section>
    );
  return (
    <Stack gap="section">
      <PageTitle title={title} back={{ href: to("/"), label: back }} />
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
