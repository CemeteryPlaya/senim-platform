import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const links = vi.hoisted(() => [] as { href: unknown; prefetch: unknown }[]);

// Ссылка переходит в другой корневой layout (v1): Next делает полную загрузку, предзагрузка бесполезна.
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => {
    links.push({ href, prefetch });
    return (
      <a href={String(href)} {...rest}>
        {children}
      </a>
    );
  },
}));

const { default: Moving } = await import("./page");

async function render(rest: string[], search: Record<string, string | string[] | undefined> = {}) {
  const el = await Moving({ params: Promise.resolve({ rest }), searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  links.length = 0;
});

describe("заглушка «раздел переносится»", () => {
  it("ссылка ведёт на тот же адрес в v1 без предзагрузки", async () => {
    await render(["deals", "1"]);
    expect(links).toEqual([{ href: "/deals/1", prefetch: false }]);
  });

  it("параметры адреса сохраняются, повторяющиеся — все", async () => {
    await render(["deals", "1"], { tab: "docs", f: ["a", "b"], empty: undefined });
    expect(links[0].href).toBe("/deals/1?tab=docs&f=a&f=b");
  });

  it("закодированные сегменты не кодируются повторно", async () => {
    await render(["requests", "%D0%B0"]);
    expect(links[0].href).toBe("/requests/%D0%B0");
  });
});
