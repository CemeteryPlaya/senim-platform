"use client";

import { Eraser, Keyboard, PenLine } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input, useFocusInvalid } from "@/ui";
import { handPayload, type HandMode, type HandPayload } from "./hand-state";

const t = ru.documents.hand;
const HEIGHT = 180;
/** Не больше 2× плотности: рисунок остаётся в пределах 256 КБ и 2000 px, которые принимает сервер. */
const MAX_DPR = 2;

export type HandSignaturePadProps = {
  /** Отправка подписи; вернуть текст ошибки — показать его под полем, null — успех. */
  onSubmit: (payload: HandPayload) => Promise<string | null>;
  /** Подпись по умолчанию в режиме «Напечатать имя» — ФИО из профиля. */
  defaultName?: string;
  /** Вид кнопки «Подписать»: secondary, когда главное действие экрана — в другом месте (StickyAction сделки). */
  submitVariant?: "primary" | "secondary";
};

/**
 * Собственноручная подпись (решение 2.2.4 а): холст под палец и мышь (Pointer Events) с «Очистить»
 * и клавиатурная альтернатива «Напечатать имя» — поле ввода, имя становится подписью-текстом.
 * Кнопки ≥ 48 px (Button), у холста — подпись и описание для экранного диктора. Ошибка напечатанного имени —
 * у самого поля (aria-invalid, фокус на поле); плашка — только для холста.
 */
export function HandSignaturePad({ onSubmit, defaultName = "", submitVariant = "primary" }: HandSignaturePadProps) {
  const [mode, setMode] = useState<HandMode>("draw");
  const [hasInk, setHasInk] = useState(false);
  const [typedName, setTypedName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «Подпись стёрлась»: холст пересчитался под новую ширину — сказать об этом, а не стереть молча.
  const [erased, setErased] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const descId = useId();
  const { ref: typedInput, focusInvalid } = useFocusInvalid<HTMLDivElement>();
  const typeButton = useRef<HTMLButtonElement>(null);

  const setInk = (value: boolean) => {
    inked.current = value;
    setHasInk(value);
  };

  // Холст в пикселях устройства: линия чёткая на телефоне. Пересчёт при смене ширины стирает рисунок — честно сбрасываем.
  useEffect(() => {
    if (mode !== "draw") return;
    const el = canvas.current;
    if (!el) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(HEIGHT * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = brand.colors.ink;
      if (inked.current) setErased(true);
      inked.current = false;
      setHasInk(false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setInk(true);
    setErased(false);
    setError(null);
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function up() {
    drawing.current = false;
  }

  function clear() {
    if (busy) return;
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    setInk(false);
  }

  // Кнопка переключения исчезает вместе с режимом: фокус — на поле имени или на «Напечатать имя».
  function switchMode(next: HandMode) {
    setMode(next);
    setError(null);
    setErased(false);
    requestAnimationFrame(() => (next === "type" ? typedInput.current?.querySelector("input") : typeButton.current)?.focus());
  }

  function fail(message: string | null) {
    setError(message);
    if (message && mode === "type") focusInvalid();
  }

  async function submit() {
    const result = handPayload({ mode, hasInk, dataUrl: mode === "draw" ? (canvas.current?.toDataURL("image/png") ?? null) : null, typedName });
    if (!result.ok) return fail(result.error);
    setBusy(true);
    const failed = await onSubmit(result.payload);
    setBusy(false);
    fail(failed);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-semibold text-ink">{t.title}</p>
      {mode === "draw" ? (
        <div className="flex flex-col gap-2">
          <canvas
            ref={canvas}
            role="img"
            aria-label={t.canvasLabel}
            aria-describedby={descId}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            style={{ height: HEIGHT, touchAction: "none" }}
            className="w-full cursor-crosshair rounded-control border-2 border-dashed border-line-strong bg-surface"
          />
          <p id={descId} className="text-base text-muted">
            {t.canvasDescription}
          </p>
          {/* Область объявлений есть всегда (пустая — только для диктора): иначе первое сообщение не прозвучит. */}
          <p role="status" className={erased ? "text-base text-ink-soft" : "sr-only"}>
            {erased ? t.erased : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* aria-disabled, а не disabled: после «Очистить» кнопка неактивна, но фокус остаётся на ней. */}
            <Button variant="secondary" onClick={clear} aria-disabled={!hasInk || busy || undefined}>
              <Eraser aria-hidden className="size-5" />
              {t.clear}
            </Button>
            <Button ref={typeButton} variant="ghost" onClick={() => switchMode("type")} disabled={busy}>
              <Keyboard aria-hidden className="size-5" />
              {t.typeInstead}
            </Button>
          </div>
        </div>
      ) : (
        <div ref={typedInput} className="flex flex-col gap-3">
          <Input
            label={t.typedLabel}
            hint={t.typedHint}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            autoComplete="name"
            maxLength={120}
            error={error ?? undefined}
          />
          {typedName.trim().length >= 2 && (
            <div className="rounded-control border border-line bg-surface px-4 py-3">
              <p className="text-base text-muted">{t.preview}</p>
              <p className="break-words font-serif text-2xl italic text-ink">{typedName.trim()}</p>
            </div>
          )}
          <Button variant="ghost" onClick={() => switchMode("draw")} disabled={busy}>
            <PenLine aria-hidden className="size-5" />
            {t.drawInstead}
          </Button>
        </div>
      )}
      <p className="text-base text-muted">{t.consent}</p>
      {error && mode === "draw" && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Button variant={submitVariant} fullWidth loading={busy} onClick={submit}>
        {t.submit}
      </Button>
    </div>
  );
}
