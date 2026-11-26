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

describe("адрес v2 без своей страницы", () => {
  it("ссылка ведёт на тот же адрес в v1 без предзагрузки", async () => {
    await render(["deals", "1"]);
    expect(links).toEqual([{ href: "/deals/1", prefetch: false }]);
  });

  it("параметры адреса сохраняются, повторяющиеся — все", async () => {
    await render(["deals", "1"], { tab: "docs", f: ["a", "b"], empty: undefined });
    expect(links[0].href).toBe("/deals/1?tab=docs&f=a&f=b");
  });

  it("/v2/deals/1?tab=money → /deals/1?tab=money", async () => {
    await render(["deals", "1"], { tab: "money" });
    expect(links[0].href).toBe("/deals/1?tab=money");
  });

  it("пустые сегменты отбрасываются: ссылка не начинается с «//»", async () => {
    await render(["", "inspiration"]);
    expect(links[0].href).toBe("/inspiration");
    await render(["", "", "deals", "", "1"]);
    expect(links[1].href).toBe("/deals/1");
    await render([""]);
    expect(links[2].href).toBe("/");
  });

  it.each([
    [["deals", "1"], "/deals/1"],
    [["", "inspiration"], "/inspiration"],
    [["d", "%2F%2Fexample.com"], "/d/%2F%2Fexample.com"],
  ])("сегменты %j → ссылка %j", async (rest, href) => {
    await render(rest);
    expect(links[0].href).toBe(href);
  });

  it.each([[["//example.com"]], [["\\example.com"]], [["\\\\example.com"]], [[" //example.com"]], [["\t", "example.com"]], [["", "example.com"]], [["%2F%2Fexample.com"]]])(
    "сегменты %j — не экран v1: «Страница не найдена», ссылки на чужой сайт нет",
    async (rest) => {
      await expect(render(rest)).rejects.toThrow();
      expect(links).toEqual([]);
    },
  );

  it("неизвестный адрес — «Страница не найдена», а не перенос", async () => {
    await expect(render(["nope"])).rejects.toThrow();
    await expect(render(["deals", "1", "nope"])).rejects.toThrow();
    expect(links).toEqual([]);
  });

  it("параметры адреса сохраняются после проверки", async () => {
    await render(["deals", "1"], { tab: "money" });
    expect(links[0].href).toBe("/deals/1?tab=money");
  });

  it("закодированные сегменты не кодируются повторно", async () => {
    await render(["requests", "%D0%B0"]);
    expect(links[0].href).toBe("/requests/%D0%B0");
  });
});
