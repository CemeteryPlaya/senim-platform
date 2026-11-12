/** Русское склонение: 1 (кроме 11), 2–4 (кроме 12–14), остальное. */
function pluralForm(n: number): "one" | "few" | "many" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

// Тексты компонентов дизайн-системы (src/kit): то, что компонент показывает сам, без участия экрана.
export const kit = {
  close: "Закрыть",
  back: "Назад",
  pending: "Подождите",
  loading: "Загрузка",
  /** Значение полосы прогресса для диктора: «2 из 3». */
  progress: (value: number, max: number) => `${value} из ${max}`,
  /** Кнопка отказа в окне подтверждения (ConfirmDialog). */
  cancel: "Отмена",
  /** Кнопка, закрывающая пояснение-шторку (Explain на телефоне). */
  understood: "Понятно",
  /** Подпись области тостов для экранного диктора. */
  notifications: "Уведомления",
  firstSteps: {
    /** Заголовок списка первых шагов: «Остался 1 шаг», «Осталось 2 шага», «Осталось 5 шагов». */
    left: (n: number) => {
      const form = pluralForm(n);
      if (form === "one") return `Остался ${n} шаг`;
      return form === "few" ? `Осталось ${n} шага` : `Осталось ${n} шагов`;
    },
    /** Подпись полосы прогресса первых шагов. */
    progressLabel: "Первые шаги",
    /** Скрытая пометка выполненного шага для диктора. */
    doneMark: "Выполнено",
  },
  nowNext: {
    now: "Сейчас",
    next: "Дальше",
  },
  help: {
    title: "Помощь",
    contact: "Написать в поддержку",
  },
  wizard: {
    /** Над заголовком мастера: «Шаг 2 из 5». */
    step: (step: number, total: number) => `Шаг ${step} из ${total}`,
    progressLabel: "Шаги",
  },
} as const;
