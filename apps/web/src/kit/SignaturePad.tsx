"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { ru } from "@/i18n/ru";
import { Button } from "./Button";
import { TextField } from "./fields";
import { drawStrokes, hasInk, toPoint, type Pen, type SignatureValue, type Stroke } from "./signature-logic";
import { TOKENS } from "./tokens";

export type { SignatureValue } from "./signature-logic";

export type SignaturePadProps = {
  /**
   * Подпись изменилась. Рисунок — строка `data:image/png` (тёмная линия на прозрачном фоне, одинаковая в обеих темах);
   * введённое ФИО — `{ typedName }`; пусто — `null`. Тип значения различают по `typeof`.
   */
  onChange: (value: SignatureValue | null) => void;
  /** Имя области для диктора («Подпись покупателя»). */
  label: string;
  /** Имя поля формы у ФИО-замены (`TextField` требует `name`); по умолчанию `signature-name`. */
  name?: string;
};

/**
 * Холст собственноручной подписи: палец, перо или мышь (Pointer Events, `setPointerCapture`, `touch-action: none`).
 * Штрихи хранятся отдельно и перерисовываются целиком: при смене темы (цвет линии — `ink` текущей темы) и размера
 * подпись не пропадает. Подсказка внутри пустого холста; «Очистить»; доступная замена — переключатель «Ввести ФИО» с
 * текстовым полем. Клиентский компонент.
 */
export function SignaturePad({ onChange, label, name = "signature-name" }: SignaturePadProps) {
  const t = ru.app.kit.signature;
  const hintId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const [inked, setInked] = useState(false);
  const [typed, setTyped] = useState(false);
  const [typedName, setTypedName] = useState("");

  const paint = useCallback(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return;
    const rect = node.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (node.width !== width || node.height !== height) {
      node.width = width;
      node.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Цвет линии — `ink` текущей темы (CSS-цвет холста); перерисовка при смене темы берёт новый.
    drawStrokes(context as unknown as Pen, strokes.current, rect.width, rect.height, getComputedStyle(node).color);
  }, []);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    paint();
    const resize = new ResizeObserver(paint);
    resize.observe(node);
    // Явная смена темы: data-theme на <html>. Смена системной темы подхватывается при возврате в окно.
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("focus", paint);
    return () => {
      resize.disconnect();
      theme.disconnect();
      window.removeEventListener("focus", paint);
    };
  }, [paint, typed]);

  /** PNG для документа: тёмная линия на прозрачном фоне независимо от темы экрана. */
  const exportImage = (): string | null => {
    const node = canvas.current;
    if (!node || !hasInk(strokes.current)) return null;
    const rect = node.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.width * ratio));
    out.height = Math.max(1, Math.round(rect.height * ratio));
    const context = out.getContext("2d");
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStrokes(context as unknown as Pen, strokes.current, rect.width, rect.height, TOKENS.light.ink);
    return out.toDataURL("image/png");
  };

  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0) return;
    node.setPointerCapture(event.pointerId);
    pointerId.current = event.pointerId;
    strokes.current = [...strokes.current, [toPoint(event.clientX, event.clientY, rect)]];
    current.current = strokes.current.length - 1;
    paint();
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== event.pointerId || current.current === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    // Промежуточные точки быстрого движения пера и пальца; без поддержки — только сама точка.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const sources = events.length > 0 ? events : [event.nativeEvent];
    const stroke = [...(strokes.current[current.current] ?? []), ...sources.map((source) => toPoint(source.clientX, source.clientY, rect))];
    strokes.current = strokes.current.map((existing, index) => (index === current.current ? stroke : existing));
    paint();
  };

  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    current.current = null;
    setInked(hasInk(strokes.current));
    onChange(exportImage());
  };

  const clear = () => {
    strokes.current = [];
    setInked(false);
    paint();
    onChange(null);
  };

  const switchMode = (nextTyped: boolean) => {
    setTyped(nextTyped);
    if (nextTyped) onChange(typedName.trim() ? { typedName: typedName.trim() } : null);
    // Штрихи сохраняются: возврат к рисунку отдаёт прежнюю подпись. Холст появляется после рендера, поэтому выгрузка — в эффекте ниже.
  };

  // После возврата к рисунку холст смонтирован заново: отдаём сохранённую подпись.
  const wasTyped = useRef(false);
  useEffect(() => {
    if (wasTyped.current && !typed) onChange(exportImage());
    wasTyped.current = typed;
    // exportImage и onChange не входят в зависимости намеренно: нужен ровно момент переключения режима.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3">
      {typed ? (
        <TextField
          label={t.nameLabel}
          name={name}
          autoComplete="name"
          value={typedName}
          onChange={(event) => {
            setTypedName(event.target.value);
            const value = event.target.value.trim();
            onChange(value ? { typedName: value } : null);
          }}
        />
      ) : (
        <>
          <div className="relative">
            <canvas
              ref={canvas}
              role="img"
              aria-label={label}
              aria-describedby={hintId}
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className="h-signature w-full cursor-crosshair touch-none rounded-field border border-line-strong bg-surface text-ink"
            />
            {!inked && (
              <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-body text-muted">
                {t.hint}
              </span>
            )}
          </div>
          <p id={hintId} className="sr-only">
            {t.alternative}
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="quiet" flush onClick={() => switchMode(!typed)}>
          {typed ? t.draw : t.typeName}
        </Button>
        {!typed && (
          <Button variant="secondary" disabled={!inked} onClick={clear}>
            {t.clear}
          </Button>
        )}
      </div>
    </div>
  );
}
