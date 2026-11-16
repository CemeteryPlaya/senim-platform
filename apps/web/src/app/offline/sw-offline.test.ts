import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://senim.example";

type Listener = (event: Record<string, unknown>) => void;

/** public/sw.js без сети: переход не удался — какую страницу воркер достаёт из кэша и что кладёт в кэш при установке. */
function offlineWorker() {
  const listeners = new Map<string, Listener>();
  const added: string[] = [];
  const cache = { add: vi.fn(async (req: Request) => void added.push(new URL(req.url).pathname + new URL(req.url).search)) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(),
    match: vi.fn(async (url: string) => new Response(url)),
  };
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    navigator: { onLine: false },
    location: new URL(ORIGIN),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  // Request с относительным адресом (как в воркере) — от адреса сайта.
  const SwRequest = class extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, ORIGIN), init);
    }
  };
  const fetch = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  runInNewContext(SOURCE, { self, caches, URL, Request: SwRequest, Response, fetch });

  async function navigate(url: string): Promise<string> {
    let response: Promise<Response> | null = null;
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: ORIGIN + url }, respondWith: (p: Promise<Response>) => (response = p) });
    if (response === null) throw new Error("воркер не ответил");
    return (await (response as Promise<Response>)).text();
  }
  async function install(): Promise<string[]> {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("install")!({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    return added;
  }
  return { navigate, install };
}

describe("public/sw.js: офлайн-страница по интерфейсу", () => {
  it("при установке кэшируются обе страницы: прежняя и в виде v2", async () => {
    expect(await offlineWorker().install()).toEqual(["/offline", "/offline?v=2"]);
  });

  it("переход в /v2 без сети — страница v2; прежние адреса — прежняя", async () => {
    const sw = offlineWorker();
    expect(await sw.navigate("/v2")).toBe("/offline?v=2");
    expect(await sw.navigate("/v2/deals/d1")).toBe("/offline?v=2");
    expect(await sw.navigate("/deals/d1")).toBe("/offline");
    expect(await sw.navigate("/v2x")).toBe("/offline");
  });
});
