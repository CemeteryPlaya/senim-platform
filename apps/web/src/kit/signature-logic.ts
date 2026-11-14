/**
 * Штрихи подписи (SignaturePad): хранятся отдельно от холста и перерисовываются целиком — при смене темы, размера окна
 * и при выгрузке картинки. Без React и браузера: рисует любой объект с методами контекста холста.
 */

/** Точка штриха; координаты — доли ширины холста (и по X, и по Y: при смене ширины подпись сохраняет пропорции). */
export type Point = { x: number; y: number };
export type Stroke = readonly Point[];

/** Что отдаёт подпись: картинка PNG (рисунок) или введённое ФИО (замена). Пусто — `null`. */
export type SignatureValue = string | { typedName: string };

/** Толщина линии, CSS-пиксели: 3 px читается и пером, и пальцем. */
export const LINE_WIDTH = 3;

/** Точка касания в долях ширины холста; `width` — текущая ширина холста в CSS-пикселях. */
export function toPoint(clientX: number, clientY: number, box: { left: number; top: number; width: number }): Point {
  return { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.width };
}

/** Есть ли что-то нарисованное. */
export function hasInk(strokes: readonly Stroke[]): boolean {
  return strokes.some((stroke) => stroke.length > 0);
}

/** Минимальный набор методов 2D-контекста, нужный для рисования (удобно подменять в тестах). */
export type Pen = {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
};

/**
 * Перерисовывает все штрихи на холсте `width` × `height` (CSS-пиксели): очищает и рисует линии цветом `color`.
 * Штрих из одной точки (касание без движения) — точка (круг диаметром в толщину линии).
 */
export function drawStrokes(pen: Pen, strokes: readonly Stroke[], width: number, height: number, color: string): void {
  pen.clearRect(0, 0, width, height);
  pen.strokeStyle = color;
  pen.fillStyle = color;
  pen.lineWidth = LINE_WIDTH;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  for (const stroke of strokes) {
    const first = stroke[0];
    if (!first) continue;
    if (stroke.length === 1) {
      pen.beginPath();
      pen.arc(first.x * width, first.y * width, LINE_WIDTH / 2, 0, Math.PI * 2);
      pen.fill();
      continue;
    }
    pen.beginPath();
    pen.moveTo(first.x * width, first.y * width);
    for (const point of stroke.slice(1)) pen.lineTo(point.x * width, point.y * width);
    pen.stroke();
  }
}

/** Дорисовывает один отрезок штриха (движение указателя): полная перерисовка нужна только при смене темы и размера. */
export function drawSegment(pen: Pen, from: Point, to: Point, width: number): void {
  pen.lineWidth = LINE_WIDTH;
  pen.lineCap = "round";
  pen.lineJoin = "round";
  pen.beginPath();
  pen.moveTo(from.x * width, from.y * width);
  pen.lineTo(to.x * width, to.y * width);
  pen.stroke();
}

/** Дорисовывает точку (касание без движения). */
export function drawDot(pen: Pen, at: Point, width: number): void {
  pen.beginPath();
  pen.arc(at.x * width, at.y * width, LINE_WIDTH / 2, 0, Math.PI * 2);
  pen.fill();
}

/** Подпись вводом ФИО: имя без пробелов по краям; пустое — подписи нет (`null`). Одно правило для ввода и для переключения режима. */
export const typedSignature = (name: string): SignatureValue | null => (name.trim() ? { typedName: name.trim() } : null);
