"use client";

import { useEffect } from "react";
import { TOP_BAR_GLASS_ATTR, TOP_BAR_LIVE_ATTR, topBarEarlyScript, topBarFade, topBarTarget } from "./top-bar-logic";

/** Переменная вида шапки над фото (landing.css): 0 — прозрачная с белым текстом, 1 — стекло. */
export const TOP_BAR_VAR = "--top-bar-p";

/**
 * Вид шапки компьютера над фото первого экрана: по прокрутке страницы ставит `--top-bar-p` в атрибут style шапки
 * (`[data-top-bar]`, она в оболочке, вне лендинга) — стекло с 1rem прокрутки, обратно ниже 0,5rem; смена — плавно за
 * 150 мс, при `prefers-reduced-motion` — сразу. Цвета и стекло считает landing.css обычными объявлениями от этой
 * переменной (не анимацией: посещённые ссылки Chrome рисует без анимированных переменных). Ставится в первый экран
 * компьютера; при уходе со страницы переменная и атрибуты снимаются.
 *
 * До запуска React вид задаёт встроенный скрипт (topBarEarlyScript): он выполняется при разборе HTML и ставит атрибут
 * стекла на `<html>` — открытая заново или по «Назад» прокрученная страница не мелькает белым текстом над светлым
 * содержимым. Скрипт — по руководству Next «Preventing Flash»: на сервере `text/javascript`, в браузере `text/plain`
 * (React не ругается на `<script>` и не выполняет его повторно), `suppressHydrationWarning` гасит разницу типов.
 */
export function TopBarOverPhoto() {
  useEffect(() => {
    const root = document.documentElement;
    const bar = document.querySelector<HTMLElement>("[data-top-bar]");
    if (!bar) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let rem = 16;
    let shown = -1;
    let target: 0 | 1 = root.hasAttribute(TOP_BAR_GLASS_ATTR) ? 1 : 0;
    let from = 0;
    let started = 0;
    let frame = 0;

    const write = (value: number) => {
      const rounded = Math.round(value * 1000) / 1000;
      if (rounded === shown) return;
      shown = rounded;
      bar.style.setProperty(TOP_BAR_VAR, String(rounded));
    };
    const tick = (now: number) => {
      const value = topBarFade(from, target, now - started, motion.matches);
      write(value);
      frame = value === target ? 0 : requestAnimationFrame(tick);
    };
    const measure = () => {
      rem = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
    };
    const update = () => {
      const next = topBarTarget(window.scrollY, rem, target);
      if (next === target) return;
      target = next;
      from = shown;
      started = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      measure();
      update();
    };

    // Вид, который уже стоит (атрибут встроенного скрипта), сверяется с прокруткой — сразу, без перехода.
    measure();
    target = topBarTarget(window.scrollY, rem, target);
    write(target);
    root.setAttribute(TOP_BAR_LIVE_ATTR, "");
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", resize);
      bar.style.removeProperty(TOP_BAR_VAR);
      root.removeAttribute(TOP_BAR_GLASS_ATTR);
      root.removeAttribute(TOP_BAR_LIVE_ATTR);
    };
  }, []);
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: topBarEarlyScript() }}
    />
  );
}
