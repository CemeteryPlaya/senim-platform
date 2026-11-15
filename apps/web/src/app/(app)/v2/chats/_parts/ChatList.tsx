import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Card, cn, List, ListItem, Monogram, StatusChip } from "@/kit";
import type { DealSide } from "../../../_shell/side";
import type { ChatRowView } from "./chat-view";

const t = ru.app.chat.list;
const tm = ru.app.masterDeal.chat.list;

/**
 * Строка-ссылка: монограмма собеседника 44 px, собеседник и время, к чему относится, последнее сообщение одной строкой с
 * обрезкой. Разделитель начинается от текста, а не от края (как в «Сообщениях»): его рисует колонка текста. Открытый
 * диалог (вторая панель на компьютере) отмечен подложкой и `aria-current`.
 */
function Row({ row, current }: { row: ChatRowView; current: boolean }) {
  return (
    <ListItem inset="none">
      <Link
        href={row.href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex min-h-control w-full items-center gap-3 px-4 py-3 text-body no-underline transition-colors duration-100 active:bg-fill-strong",
          current ? "bg-fill" : "hover:bg-canvas",
        )}
      >
        <Monogram name={row.counterpart} size="md" />
        <span className="relative flex min-w-0 flex-1 items-center gap-3 self-stretch after:pointer-events-none after:absolute after:-right-4 after:-bottom-3 after:left-0 after:border-b after:border-line group-last/row:after:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-headline wrap-anywhere text-ink">{row.counterpart}</span>
              {row.time && <span className="shrink-0 text-sub text-muted">{row.time}</span>}
            </span>
            <span className="text-sub wrap-break-word text-muted">{row.title}</span>
            <span className="truncate text-body text-ink">{row.last}</span>
            {row.closed && (
              <span className="flex">
                <StatusChip tone="neutral">{t.closed}</StatusChip>
              </span>
            )}
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
        </span>
      </Link>
    </ListItem>
  );
}

/**
 * Список диалогов стороны (сгруппированный список): «Чаты» на телефоне и левая панель (360 px) на компьютере — на экране
 * списка и рядом с открытой перепиской. `current` — открытый диалог. `className` — размеры панели (своя прокрутка).
 */
export function ChatList({ rows, side, current = null, className }: { rows: readonly ChatRowView[]; side: DealSide; current?: string | null; className?: string }) {
  return (
    <Card variant="grouped" className={className}>
      <nav aria-label={side === "EXECUTOR" ? tm.label : t.label}>
        <List>
          {rows.map((row) => (
            <Row key={row.offerId} row={row} current={row.offerId === current} />
          ))}
        </List>
      </nav>
    </Card>
  );
}

/**
 * Компьютер: «Чаты» в две панели, как в «Сообщениях» (разбор 3.9) — один каркас у списка (`/v2/chats`) и у диалога
 * (`/v2/chats/<id>`), поэтому при переходе левая панель не прыгает. Слева заголовок «Чаты» (`heading`: на экране списка —
 * его h1, у диалога — h2 того же размера; h1 там — собеседник) и список 360 px со своей прокруткой; справа — `children`
 * (подсказка или переписка). Всё — на высоту окна за вычетом шапки (`screen-fill`); правая панель прокручивается сама,
 * если её содержимое выше окна (низкое окно, крупный шрифт), — страница не прокручивается.
 */
export function ChatPanes({ rows, side, current = null, heading, children }: { rows: readonly ChatRowView[]; side: DealSide; current?: string | null; heading: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-chats grid-rows-1 gap-split screen-fill">
      <div className="flex min-h-0 min-w-0 flex-col gap-stack-section">
        {heading}
        <div className="min-h-0 overflow-y-auto rounded-card">
          <ChatList rows={rows} side={side} current={current} />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col gap-stack-section overflow-y-auto">{children}</div>
    </div>
  );
}
