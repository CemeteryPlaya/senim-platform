/**
 * Показ после нажатия. Поле, которое проверяет себя при уходе (`blur`), не должно менять вид страницы, пока палец или кнопка
 * мыши нажаты: уход с поля случается на нажатии, ошибка под полем сдвинула бы кнопку в потоке страницы, и отпускание
 * пришлось бы мимо неё — щелчок потерялся бы (так на компьютере; в Safari кнопка ещё и не получает фокус, поэтому
 * смотреть на `relatedTarget` мало). Документ помнит нажатые указатели (`pointerdown` / `pointerup` / `pointercancel`);
 * `afterPress(run)` выполняет `run` сразу, если ничего не нажато, иначе — после отпускания, в следующем кадре: `click`
 * идёт в той же задаче, что и `pointerup`, и успевает сработать раньше. Только браузер; без документа — сразу.
 */

const pressed = new Set<number>();
let waiting: (() => void)[] = [];
let installed = false;

function release(pointerId: number): void {
  pressed.delete(pointerId);
  if (pressed.size > 0 || waiting.length === 0) return;
  const runs = waiting;
  waiting = [];
  requestAnimationFrame(() => {
    for (const run of runs) run();
  });
}

/** Слушатели на документе — один раз; в фазе перехвата, чтобы `stopPropagation` экрана их не глушил. */
export function trackPresses(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerdown", (event) => pressed.add(event.pointerId), true);
  document.addEventListener("pointerup", (event) => release(event.pointerId), true);
  document.addEventListener("pointercancel", (event) => release(event.pointerId), true);
  // Кнопку отпустили за пределами окна: `pointerup` сюда не пришёл, движение без нажатых кнопок снимает зависшее нажатие.
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.buttons === 0 && pressed.has(event.pointerId)) release(event.pointerId);
    },
    true,
  );
}

/** Выполнить `run` сейчас, а если идёт нажатие — после отпускания (в следующем кадре). */
export function afterPress(run: () => void): void {
  trackPresses();
  if (pressed.size === 0) run();
  else waiting.push(run);
}

// Слушать с загрузки модуля: нажатие, ради которого откладывают показ, начинается раньше ухода с поля.
trackPresses();
