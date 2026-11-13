import type { ReactNode } from "react";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import AppError from "./error";

// Компонент вызывается как функция (без рендера React): эффект журнала в этом тесте не нужен.
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useEffect: () => undefined }));
vi.mock("@/platform/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const t = ru.app.shell;

/** Первый элемент дерева с обработчиком `onClick` (ищет в props.children вглубь). */
function findOnClick(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return undefined;
  if (typeof node.props.onClick === "function") return node.props.onClick;
  const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const kid of kids) {
    const found = findOnClick(kid as ReactNode);
    if (found) return found;
  }
  return undefined;
}

describe("error.tsx группы (app)", () => {
  const retry = vi.fn();
  const element = AppError({ error: new Error("сбой"), retry });
  const out = html(element);

  it("один <h1> — заголовок из ru, под ним строка пояснения", () => {
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.errorTitle);
    expect(out).toContain(t.errorBody);
  });

  it("одно главное действие — «Повторить»; ссылка на главную v2 — вторая", () => {
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toMatch(new RegExp(`<button [^>]*data-primary-action[^>]*>(?:<span[^>]*>)?${t.errorRetry}`));
    expect(out).toMatch(new RegExp(`<a [^>]*href="/v2"[^>]*>${t.errorHome}</a>`));
  });

  it("«Повторить» вызывает retry", () => {
    const onClick = findOnClick(element);
    expect(onClick).toBeTypeOf("function");
    onClick?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
