import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailColumns } from "./index";

describe("DetailColumns", () => {
  const html = renderToStaticMarkup(<DetailColumns lead={<p>шаги</p>} aside={<p>деньги</p>} main={<p>события</p>} action={<button>действие</button>} />);

  it("порядок на телефоне: верх, деньги, события, действие — действие последним", () => {
    const order = ["шаги", "деньги", "события", "действие"].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("действие — в слоте StickyAction, правая колонка десктопа", () => {
    expect(html).toMatch(/<div[^>]*data-sticky-action[^>]*class="[^"]*lg:col-start-2[^"]*"[^>]*><button>действие<\/button>/);
  });

  it("без действия нет и слота", () => {
    const bare = renderToStaticMarkup(<DetailColumns aside={<p>a</p>} main={<p>b</p>} />);
    expect(bare).not.toContain("data-sticky-action");
  });
});
