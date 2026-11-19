"use client";

import { useEffect } from "react";
import { TOP_BAR_GLASS_FROM_REM, topBarFade, topBarTarget } from "./top-bar-logic";

/** Переменная вида шапки над фото (landing.css): 0 — прозрачная с белым текстом, 1 — стекло. */
export const TOP_BAR_VAR = "--top-bar-p";

/**
 * Вид шапки компьютера над фото первого экрана: по прокрутке страницы ставит `--top-bar-p` в атрибут style шапки
 * (`[data-top-bar]`, она в оболочке, вне лендинга) — 0 до 1rem прокрутки, 1 дальше; смена — плавно за 150 мс, при
 * `prefers-reduced-motion` — сразу. Цвета и стекло считает landing.css обычными объявлениями от этой переменной (не
 * анимацией: посещённые ссылки Chrome рисует без анимированных переменных). Ничего не рисует; ставится в первый экран
 * компьютера. При уходе со страницы переменная снимается.
 */
export function TopBarOverPhoto() {
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-top-bar]");
    if (!bar) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let glassFrom = 16;
    let shown = -1;
    let target = 0;
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
      glassFrom = TOP_BAR_GLASS_FROM_REM * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    };
    const update = () => {
      const next = topBarTarget(window.scrollY, glassFrom);
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

    // Открыли страницу (в том числе прокрученной) — сразу нужный вид, без перехода.
    measure();
    target = topBarTarget(window.scrollY, glassFrom);
    write(target);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", resize);
      bar.style.removeProperty(TOP_BAR_VAR);
    };
  }, []);
  return null;
}
