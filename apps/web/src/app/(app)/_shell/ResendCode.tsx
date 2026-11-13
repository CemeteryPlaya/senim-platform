"use client";

import { useEffect, useState } from "react";
import { Button } from "@/kit";
import { secondsLeft } from "./countdown";

type Props = {
  /** Когда сервис примет новый запрос кода (миллисекунды Unix). */
  until: number;
  /** id формы повторной отправки: кнопка стоит вне неё и связана атрибутом `form`. */
  form: string;
  /** Идёт повторная отправка. */
  pending: boolean;
  /** Подпись действия: «Отправить ещё раз». */
  label: string;
  /** Строка ожидания: «Отправить ещё раз через 0:45». */
  waitLabel: (seconds: number) => string;
};

/**
 * Повторная отправка кода (вход и почта): пока сервис не примет новый запрос — строка вторичного текста с отсчётом
 * (не кнопка и не отключённая кнопка), после — тихая кнопка. Отсчёт раз в секунду, без анимации; первая отрисовка — от
 * `until` (вернулись «Назад» браузера — не мелькает «1:00»). Тикающий текст диктору не объявляется (нет aria-live):
 * его читают, когда до него дошли. Высота строки — высота поля касания (48 px) в обоих состояниях; текст ожидания и подпись
 * тихой кнопки без боковых отступов (`flush`) стоят по левой линии содержимого: смена состояния ничего не сдвигает.
 * Новый код — новый `key` у компонента, отсчёт начинается заново.
 */
export function ResendCode({ until, form, pending, label, waitLabel }: Props) {
  const [left, setLeft] = useState(() => secondsLeft(until, Date.now()));
  useEffect(() => {
    if (secondsLeft(until, Date.now()) === 0) return;
    const id = window.setInterval(() => {
      const seconds = secondsLeft(until, Date.now());
      setLeft(seconds);
      if (seconds === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return (
    <div data-resend-code className="flex min-h-control items-center">
      {left > 0 ? (
        <p className="text-sub text-muted tabular-nums">{waitLabel(left)}</p>
      ) : (
        <Button type="submit" form={form} variant="quiet" size="sm" flush pending={pending}>
          {label}
        </Button>
      )}
    </div>
  );
}
