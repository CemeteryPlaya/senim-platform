/**
 * Замок «одно за раз»: пока прошлая работа не закончилась, новая не начинается. Нужен опросу ленты (запросы не
 * накладываются) и отправке (двойное нажатие — одно сообщение).
 */
export type Gate = { enter(): boolean; leave(): void };

export function createGate(): Gate {
  let busy = false;
  return {
    enter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() {
      busy = false;
    },
  };
}

/** Опрос идёт только пока вкладка видна: скрытая вкладка запросов не шлёт. */
export const shouldPoll = (visibility: DocumentVisibilityState): boolean => visibility === "visible";
