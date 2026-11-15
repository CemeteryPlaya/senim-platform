"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export type PhotoImageProps = {
  src: string;
  alt: string;
  /** Ширина картинки на экране для `next/image` (`sizes`): браузер берёт подходящий размер, а не оригинал. */
  sizes: string;
  /** Первый экран: грузить сразу, без ленивой загрузки. */
  priority?: boolean;
  className?: string;
};

/**
 * Загруженные людьми файлы раздаёт `/api/files/*` по подписанной ссылке с сроком: через оптимизатор картинок они не
 * идут (чужой кеш для приватного файла, а у ссылки есть query). Статика интерфейса (`/stand-photos/…`) — через него.
 */
export function bypassOptimizer(src: string): boolean {
  return !src.startsWith("/stand-photos/");
}

/**
 * Фото, заполняющее родителя (`photo-frame`, `relative` с заданным соотношением сторон — сдвига раскладки нет):
 * `next/image` с `fill`, `sizes` и проявлением `opacity` за 200 мс, когда картинка загрузилась. До этого — заливка
 * `photo-fallback` обёртки. Уже загруженную до гидратации картинку подхватывает проверка `complete`. Без скриптов и при
 * `prefers-reduced-motion` картинка видна сразу (`photo-reveal`).
 */
export function PhotoImage({ src, alt, sizes, priority = false, className }: PhotoImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ref.current?.complete) setReady(true);
  }, []);
  return (
    <Image
      ref={ref}
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={bypassOptimizer(src)}
      onLoad={() => setReady(true)}
      data-ready={ready ? "" : undefined}
      className={cn("photo-reveal object-cover", className)}
    />
  );
}
