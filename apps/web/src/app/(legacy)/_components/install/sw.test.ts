import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://senim.example";

type Listener = (event: Record<string, unknown>) => void;

/** public/sw.js в отдельном контексте с поддельным self: события вызываются так же, как их шлёт браузер. */
function loadWorker(opts: { online?: boolean; windows?: { url: string }[] } = {}) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const windows = (opts.windows ?? []).map((w) => ({ ...w, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) }));
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    navigator: { onLine: opts.online ?? true },
    location: new URL(ORIGIN),
    registration: { showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => void shown.push({ title, options })) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => undefined), claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  const caches = { open: vi.fn(), keys: vi.fn(async () => []), match: vi.fn(), delete: vi.fn() };
  runInNewContext(SOURCE, { self, caches, URL, Request, Response, fetch: vi.fn() });

  async function dispatch(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p), respondWith: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { self, shown, windows, dispatch, listeners };
}

const pushData = (value: unknown) => ({ json: () => (typeof value === "string" ? JSON.parse(value) : value) });

describe("public/sw.js: push", () => {
  it("показывает заголовок и текст с сервера, повтор с тем же tag заменяет уведомление", async () => {
    const sw = loadWorker();
    await sw.dispatch("push", { data: pushData({ title: "Деньги зарезервированы", body: "Откройте, чтобы посмотреть подробности", url: "/deals/d7", tag: "n1" }) });
    expect(sw.shown).toEqual([
      { title: "Деньги зарезервированы", options: { body: "Откройте, чтобы посмотреть подробности", tag: "n1", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: "/deals/d7" } } },
    ]);
  });

  it("чужая ссылка в push заменяется страницей уведомлений; без данных — всё равно показывает уведомление", async () => {
    const sw = loadWorker();
    await sw.dispatch("push", { data: pushData({ title: "Событие", url: "https://evil.example/phish" }) });
    await sw.dispatch("push", { data: pushData("не json") });
    await sw.dispatch("push", { data: null });
    expect(sw.shown.map((s) => s.options.data)).toEqual([{ url: "/notifications" }, { url: "/notifications" }, { url: "/notifications" }]);
    expect(sw.shown[1]!.title).toBe("senim.example");
  });
});

describe("public/sw.js: нажатие на уведомление", () => {
  const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

  it("открытое окно приложения переводится на ссылку", async () => {
    const sw = loadWorker({ windows: [{ url: `${ORIGIN}/requests` }] });
    const event = click("/deals/d7");
    await sw.dispatch("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(sw.windows[0]!.focus).toHaveBeenCalled();
    expect(sw.windows[0]!.navigate).toHaveBeenCalledWith(`${ORIGIN}/deals/d7`);
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("окна нет — открывает новое; внешний адрес не открывает", async () => {
    const sw = loadWorker({ windows: [{ url: "https://other.example/" }] });
    await sw.dispatch("notificationclick", click("//evil.example/x"));
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`);
  });
});

describe("public/sw.js: офлайн-логика не изменилась", () => {
  it("при сети переходы идут мимо воркера, запросы данных не перехватываются никогда", async () => {
    const online = loadWorker({ online: true });
    const respondWith = vi.fn();
    online.listeners.get("fetch")!({ request: { method: "GET", mode: "navigate" }, respondWith });
    const offline = loadWorker({ online: false });
    offline.listeners.get("fetch")!({ request: { method: "GET", mode: "cors" }, respondWith });
    offline.listeners.get("fetch")!({ request: { method: "POST", mode: "navigate" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("в воркере нет записи в кэш, кроме офлайн-страницы при установке", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code.match(/cache\.(add|put|addAll)\(/g)).toEqual(["cache.add("]);
    expect(code).not.toMatch(/\.put\(/);
  });
});
