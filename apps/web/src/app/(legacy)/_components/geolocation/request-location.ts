import { ru } from "@/i18n/ru";

/** Место устройства для мягкой GPS-проверки (сдача работы, адрес заявки): точность — радиус в метрах. */
export type GeoFix = { lat: number; lng: number; accuracyM: number };

/**
 * denied — пользователь запретил доступ к месту; unavailable — место не определилось (нет GPS, помещение);
 * timeout — не успели; unsupported — браузер не умеет; insecure — страница не по https (браузер не даст место).
 */
export type GeoErrorCode = "denied" | "unavailable" | "timeout" | "unsupported" | "insecure";

/** Ошибка с понятным текстом для экрана (ru.files.geolocation.errors) и кодом для решения экрана. */
export class GeolocationError extends Error {
  constructor(readonly code: GeoErrorCode) {
    super(ru.files.geolocation.errors[code]);
    this.name = "GeolocationError";
  }
}

export type RequestLocationOptions = {
  /** Сколько ждать определения места после разрешения. По умолчанию 15 с. */
  timeoutMs?: number;
  /** Свежесть сохранённого браузером места. По умолчанию минута: человек не успел уйти от объекта. */
  maxAgeMs?: number;
  /** Для тестов и необычных сред: по умолчанию navigator.geolocation и window.isSecureContext. */
  geolocation?: Pick<Geolocation, "getCurrentPosition"> | null;
  secureContext?: boolean;
};

/** Сколько ещё ждать, пока человек отвечает на запрос разрешения: timeout браузера идёт только после ответа. */
const PROMPT_GRACE_MS = 30_000;
const BROWSER_CODES: Record<number, GeoErrorCode> = { 1: "denied", 2: "unavailable", 3: "timeout" };

function defaults(): { geolocation: Pick<Geolocation, "getCurrentPosition"> | null; secureContext: boolean } {
  if (typeof navigator === "undefined") return { geolocation: null, secureContext: false };
  return { geolocation: "geolocation" in navigator ? navigator.geolocation : null, secureContext: typeof window === "undefined" || window.isSecureContext };
}

/**
 * Запросить место устройства один раз. Вызывать по нажатию (иначе браузер может не показать запрос).
 * Отказ, нет GPS или таймаут — GeolocationError с понятным текстом: проверка мягкая, экран продолжает без места.
 */
export function requestLocation(options: RequestLocationOptions = {}): Promise<GeoFix> {
  const env = defaults();
  const geolocation = options.geolocation === undefined ? env.geolocation : options.geolocation;
  const secure = options.secureContext ?? env.secureContext;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!secure) return Promise.reject(new GeolocationError("insecure"));
  if (!geolocation) return Promise.reject(new GeolocationError("unsupported"));

  return new Promise<GeoFix>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      fn();
    };
    // Запрос разрешения проигнорирован (окно открыто, человек ушёл) — браузер может не ответить никогда.
    const guard = setTimeout(() => finish(() => reject(new GeolocationError("timeout"))), timeoutMs + PROMPT_GRACE_MS);
    geolocation.getCurrentPosition(
      ({ coords }) => finish(() => resolve({ lat: coords.latitude, lng: coords.longitude, accuracyM: Math.max(0, Math.round(coords.accuracy)) })),
      (error) => finish(() => reject(new GeolocationError(BROWSER_CODES[error.code] ?? "unavailable"))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: options.maxAgeMs ?? 60_000 },
    );
  });
}
