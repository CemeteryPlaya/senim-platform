"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { mosaicShape, stepIndex, swipeDelta } from "./gallery-logic";
import { useReturnFocus } from "./overlay-state";
import { bypassOptimizer } from "./PhotoImage";
import { PhotoSlot } from "./PhotoSlot";

export type GalleryPhoto = {
  src: string;
  alt: string;
  /** Подпись под снимком в галерее на весь экран (название работы, дата отчёта). */
  caption?: string;
};

export type PhotoGalleryProps = {
  photos: readonly GalleryPhoto[];
  /**
   * `mosaic` — профиль мастера: один большой снимок и два малых (на телефоне большой сверху, малые под ним; на компьютере
   * большой слева, малые столбцом справа), остальные — в галерее; `strip` — лента отчётов «Ход работ»: снимки 4 : 3 в
   * ряд (на телефоне — прокручивается по горизонтали, на компьютере — сетка из трёх колонок); `cover` — обложка: первый
   * снимок 16 : 9 во всю ширину (радиус карточки, загрузка в первую очередь), по нажатию — галерея всех снимков.
   */
  layout: "mosaic" | "strip" | "cover";
  /** Имя группы снимков для диктора. */
  label: string;
  /** Ширина малого снимка на экране для `next/image`; по умолчанию — для мозаики основной колонки профиля. */
  sizes?: string;
  /** Только `cover`: слой поверх обложки (затемнение и капсула `glass-clear`). */
  overlay?: ReactNode;
};

const TILE_SIZES = "(min-width: 64rem) 360px, 50vw";
const BIG_SIZES = "(min-width: 64rem) 720px, 100vw";

const TILE = "relative block w-full min-w-0 pressable focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded-thumb";

/**
 * Снимки работ плитками и галерея на весь экран по нажатию. Плитка — кнопка (имя — `alt` снимка), открывает окно с
 * этим снимком. Окно — Radix Dialog: фокус внутри, Esc закрывает, фокус возвращается на нажатую плитку (useReturnFocus);
 * стрелки влево и вправо листают по кругу, на телефоне — смахивание (жест только по горизонтали: вертикальная
 * прокрутка не листает); кнопки «Предыдущее» и «Следующее» — 48 px, есть везде. Счётчик «2 из 5» и подпись — на
 * `glass-clear` и на чёрном (белый на чёрном 21:1). Смена снимка без анимации: при `prefers-reduced-motion` ничего не
 * меняется. Клиентский компонент.
 */
export function PhotoGallery({ photos, layout, label, sizes, overlay }: PhotoGalleryProps) {
  const [index, setIndex] = useState<number | null>(null);
  const open = index !== null;
  const returnFocus = useReturnFocus(open, true);
  if (photos.length === 0) return null;

  const tile = (photo: GalleryPhoto, i: number, className: string, tileSizes: string, extra?: ReactNode, fillCell = false) => (
    <button key={`${i}-${photo.src}`} type="button" aria-haspopup="dialog" onClick={() => setIndex(i)} className={cn(TILE, fillCell && "desktop:h-full", className)}>
      <PhotoSlot ratio="4/3" src={photo.src} alt={photo.alt} sizes={tileSizes} className={fillCell ? "desktop:aspect-auto desktop:h-full" : undefined}>
        {extra}
      </PhotoSlot>
    </button>
  );

  let tiles: ReactNode;
  if (layout === "cover") {
    const first = photos[0];
    tiles = first && (
      <button type="button" aria-haspopup="dialog" onClick={() => setIndex(0)} className={cn(TILE, "rounded-card")}>
        <PhotoSlot ratio="16/9" src={first.src} alt={first.alt} radius="none" sizes={sizes ?? BIG_SIZES} priority className="rounded-card">
          {overlay}
        </PhotoSlot>
      </button>
    );
  } else if (layout === "strip") {
    const single = photos.length === 1;
    tiles = (
      <ul aria-label={label} className="-m-1 flex snap-x snap-mandatory gap-2 overflow-x-auto p-1 desktop:grid desktop:grid-cols-3 desktop:overflow-visible">
        {photos.map((photo, i) => (
          <li key={`${i}-${photo.src}`} className={cn("shrink-0 snap-start desktop:w-auto", single ? "w-full" : "w-4/5")}>
            {tile(photo, i, "", sizes ?? TILE_SIZES)}
          </li>
        ))}
      </ul>
    );
  } else {
    const shape = mosaicShape(photos.length);
    const shown = photos.slice(0, shape === "three" ? 3 : photos.length);
    const more = photos.length > 3;
    const big = (
      <>
        <div aria-hidden className="scrim-photo" />
        <span className="glass-clear absolute bottom-3 left-3 rounded-chip px-3 py-1 text-body">{ru.app.kit.gallery.all(photos.length)}</span>
      </>
    );
    tiles = (
      <div
        role="group"
        aria-label={label}
        className={cn(
          "grid gap-2",
          shape === "three" && "grid-cols-2 desktop:aspect-2/1 desktop:grid-cols-3 desktop:grid-rows-2",
          shape === "two" && "grid-cols-2",
          shape === "one" && "grid-cols-1",
        )}
      >
        {shown.map((photo, i) =>
          tile(
            photo,
            i,
            i === 0 && shape === "three" ? "col-span-2 desktop:row-span-2" : "",
            i === 0 ? (sizes ?? BIG_SIZES) : (sizes ?? TILE_SIZES),
            i === 0 && more ? big : undefined,
            shape === "three",
          ),
        )}
      </div>
    );
  }

  const total = photos.length;
  const current = index === null ? null : photos[index];
  const go = (delta: -1 | 1) => setIndex((i) => (i === null ? i : stepIndex(i, delta, total)));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(-1);
    else if (event.key === "ArrowRight") go(1);
    else return;
    event.preventDefault();
  };

  return (
    <>
      {tiles}
      <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && setIndex(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onKeyDown={onKeyDown}
            onCloseAutoFocus={returnFocus}
            className="gallery-in fixed inset-0 z-50 flex flex-col bg-scrim text-on-photo outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{ru.app.kit.gallery.title}</DialogPrimitive.Title>
            {current && index !== null && <Viewer photo={current} position={index + 1} total={total} onStep={go} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

const ROUND = "glass-clear pressable inline-flex size-control shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Окно: счётчик и «Закрыть» сверху, снимок по центру (целиком, `object-contain`), подпись снизу; жест смахивания — на области снимка. */
function Viewer({ photo, position, total, onStep }: { photo: GalleryPhoto; position: number; total: number; onStep: (delta: -1 | 1) => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (event: PointerEvent) => {
    start.current = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from || total < 2) return;
    const delta = swipeDelta(event.clientX - from.x, event.clientY - from.y);
    if (delta !== 0) onStep(delta);
  };
  return (
    <>
      <div className="flex items-center justify-between gap-3 safe-gutter pt-3">
        <p aria-live="polite" className="glass-clear rounded-chip px-3 py-1 text-body tabular-nums">
          {ru.app.kit.gallery.counter(position, total)}
        </p>
        <DialogPrimitive.Close aria-label={ru.app.kit.close} className={ROUND}>
          <X aria-hidden className="size-6" />
        </DialogPrimitive.Close>
      </div>
      <div className="relative min-h-0 flex-1 touch-pan-y" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => {
          start.current = null;
        }}>
        <Image
          key={photo.src}
          src={photo.src}
          alt={photo.alt}
          fill
          sizes="100vw"
          priority
          unoptimized={bypassOptimizer(photo.src)}
          draggable={false}
          className="select-none object-contain"
        />
        {total > 1 && (
          <>
            <button type="button" aria-label={ru.app.kit.gallery.prev} onClick={() => onStep(-1)} className={cn(ROUND, "absolute top-1/2 left-3 -translate-y-1/2")}>
              <ChevronLeft aria-hidden className="size-6" />
            </button>
            <button type="button" aria-label={ru.app.kit.gallery.next} onClick={() => onStep(1)} className={cn(ROUND, "absolute top-1/2 right-3 -translate-y-1/2")}>
              <ChevronRight aria-hidden className="size-6" />
            </button>
          </>
        )}
      </div>
      <p className="min-h-14 safe-gutter pt-3 pb-4 text-center text-body text-on-photo">{photo.caption ?? " "}</p>
    </>
  );
}
