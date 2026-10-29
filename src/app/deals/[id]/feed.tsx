"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  Check,
  Coins,
  FileText,
  Landmark,
  Lock,
  Paperclip,
  PenLine,
  Pencil,
  Scale,
  SendHorizontal,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendMessageAction } from "@/app/actions";
import type { DealFull } from "@/lib/deal/query";
import { dateTime, time } from "@/lib/format";
import { Avatar, Card } from "@/components/ui";
import { compressImage } from "@/components/photo-input";
import { PhotoGrid } from "@/components/photo-grid";
import { useAction } from "@/components/use-action";

const ICONS: Record<string, LucideIcon> = {
  file: FileText,
  check: Check,
  edit: Pencil,
  x: X,
  pen: PenLine,
  bank: Landmark,
  lock: Lock,
  upload: Upload,
  coins: Coins,
  undo: Undo2,
  alert: AlertTriangle,
  scale: Scale,
};

const ICON_TONE: Record<string, string> = {
  lock: "bg-brand text-white",
  coins: "bg-[#E9B44C] text-ink",
  alert: "bg-red text-white",
  pen: "bg-blue text-white",
  check: "bg-brand-soft text-brand",
};

export function Feed({ deal, meId, canWrite }: { deal: DealFull; meId: string; canWrite: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, run, error } = useAction();
  const count = deal.events.length;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const toBottom = () => el.scrollTo({ top: el.scrollHeight });
    toBottom();
    // повторно — после загрузки картинок высота ленты меняется
    const t = setTimeout(toBottom, 400);
    return () => clearTimeout(t);
  }, [count]);

  function send() {
    if (!text.trim() && !image) return;
    run(
      () => sendMessageAction(deal.id, text, image ?? undefined),
      () => {
        setText("");
        setImage(null);
      },
    );
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-bold">Лента сделки</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> обновляется вживую
        </span>
      </div>

      <div ref={scroller} className="max-h-[520px] min-h-[280px] space-y-3 overflow-y-auto bg-surface-2 px-3 py-4">
        {deal.events.map((e) => {
          if (e.kind === "SYSTEM") {
            const Icon = ICONS[e.icon ?? "check"] ?? Check;
            return (
              <div key={e.id} className="animate-rise flex gap-2.5 px-1">
                <span
                  className={clsx(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    ICON_TONE[e.icon ?? ""] ?? "bg-ink/10 text-ink",
                  )}
                >
                  <Icon size={13} />
                </span>
                <div className="min-w-0 text-[13px] leading-snug">
                  <div>{e.text}</div>
                  {e.image && <PhotoGrid photos={[e.image]} className="mt-1.5" />}
                  <div className="mt-0.5 text-[11px] text-muted">{dateTime(e.createdAt)}</div>
                </div>
              </div>
            );
          }
          const mine = e.actorId === meId;
          const actor = e.actor;
          return (
            <div key={e.id} className={clsx("animate-rise flex items-end gap-2", mine && "flex-row-reverse")}>
              {actor && <Avatar name={actor.name} color={actor.avatar} size={26} />}
              <div
                className={clsx(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                  mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md border border-line bg-surface",
                )}
              >
                {!mine && actor && <div className="mb-0.5 text-[11px] font-semibold text-accent">{actor.name}</div>}
                {e.text && <div className="whitespace-pre-wrap">{e.text}</div>}
                {e.image && <PhotoGrid photos={[e.image]} className="mt-1.5" />}
                <div className={clsx("mt-0.5 text-right text-[10px]", mine ? "text-white/70" : "text-muted")}>{time(e.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {canWrite && (
        <div className="border-t border-line p-2.5">
          {image && (
            <div className="relative mb-2 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="h-16 rounded-lg border border-line" />
              <button onClick={() => setImage(null)} className="absolute -top-1.5 -right-1.5 rounded-full bg-ink p-0.5 text-white">
                <X size={12} />
              </button>
            </div>
          )}
          {error && <p className="mb-2 text-xs text-red">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Прикрепить фото"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setImage(await compressImage(f));
                e.target.value = "";
              }}
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Сообщение…"
              className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/15"
            />
            <button
              onClick={send}
              disabled={pending || (!text.trim() && !image)}
              className="rounded-xl bg-brand p-2 text-white disabled:opacity-40"
              aria-label="Отправить"
            >
              <SendHorizontal size={18} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
