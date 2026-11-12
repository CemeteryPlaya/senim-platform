import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, ConfirmDialog, Dialog, Explain, Popover, Sheet, Toaster } from "./index";
import { SPRING } from "./motion";

// Статический рендер закрытого состояния: в разметке только триггер. Поведение открытого окна
// (фокус внутри и возврат на триггер, Esc, затемнение, жест шторки) проверяет e2e (задача 10).

const html = (el: ReactElement): string => renderToStaticMarkup(el);

describe("Explain", () => {
  it("на телефоне — ссылка-кнопка, открывающая шторку", () => {
    const m = html(
      <Explain label="Что это?" title="Защита сделки" device="mobile">
        Текст
      </Explain>,
    );
    expect(m).toMatch(/<button[^>]*>Что это\?<\/button>/);
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).toContain('aria-expanded="false"');
    expect(m).toContain("text-accent");
    expect(m).not.toContain("Текст");
  });

  it("на компьютере — та же ссылка-кнопка, открывающая поповер", () => {
    const d = html(
      <Explain label="Что это?" title="Защита сделки" device="desktop">
        Текст
      </Explain>,
    );
    expect(d).toMatch(/<button[^>]*>Что это\?<\/button>/);
    expect(d).toContain('aria-haspopup="dialog"');
    expect(d).not.toContain("Текст");
  });
});

describe("закрытые окна рендерятся без ошибок и показывают только триггер", () => {
  it("Sheet", () => {
    const m = html(
      <Sheet title="Выбор" trigger={<Button variant="secondary">Открыть</Button>}>
        Содержимое
      </Sheet>,
    );
    expect(m).toContain("Открыть");
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).not.toContain("Содержимое");
    expect(html(<Sheet title="Выбор" open={false} onOpenChange={() => {}}>Содержимое</Sheet>)).toBe("");
  });

  it("Popover", () => {
    const m = html(<Popover trigger={<Button variant="quiet">Ещё</Button>}>Содержимое</Popover>);
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).not.toContain("Содержимое");
  });

  it("Dialog", () => {
    const m = html(
      <Dialog title="Заголовок" trigger={<Button variant="secondary">Открыть</Button>}>
        Содержимое
      </Dialog>,
    );
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).not.toContain("Содержимое");
  });

  it.each(["mobile", "desktop"] as const)("ConfirmDialog (%s)", (device) => {
    const m = html(
      <ConfirmDialog
        device={device}
        trigger={<Button variant="danger">Отменить сделку</Button>}
        title="Отменить сделку?"
        description="Это нельзя вернуть."
        confirmLabel="Отменить сделку"
        tone="danger"
        onConfirm={() => {}}
      />,
    );
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).not.toContain("Это нельзя вернуть.");
  });

  it.each(["mobile", "desktop"] as const)("Toaster (%s) без тостов", (device) => {
    expect(() => html(<Toaster device={device} />)).not.toThrow();
  });
});

describe("SPRING", () => {
  it("по умолчанию без отскока, отскок только после броска", () => {
    expect(SPRING.default.bounce).toBe(0);
    expect(SPRING.default.type).toBe("spring");
    expect(SPRING.flick.bounce).toBe(0.2);
    expect(SPRING.flick.type).toBe("spring");
  });
});

describe("меньше движения и меньше прозрачности (CSS)", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const reduceBlock = (source: string) =>
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";

  it("app.css: переходы только прозрачности и цвета, индикаторы загрузки пульсируют, а не замирают", () => {
    const block = reduceBlock(read("../app/(app)/app.css"));
    const transition = /transition-property:\s*([^;!]+)/.exec(block)?.[1] ?? "";
    expect(transition).toContain("opacity");
    expect(transition).not.toMatch(/transform|translate|scale|rotate|\ball\b/);
    expect(block).toMatch(/\.animate-spin[\s\S]*?animation:\s*kit-pulse[^;]*infinite/);
    expect(read("../app/(app)/app.css")).toMatch(/@keyframes kit-pulse\s*\{\s*50%\s*\{\s*opacity:/);
  });

  it("overlays.css: шторка и затемнение проявляются, а не выезжают", () => {
    const block = reduceBlock(read("overlays.css"));
    expect(block).toMatch(/\[data-vaul-drawer\]\[data-state="open"\][\s\S]*?animation-name:\s*kit-fade-in/);
    expect(block).toMatch(/\[data-vaul-drawer\]\[data-state="closed"\][\s\S]*?animation-name:\s*kit-fade-out/);
    expect(read("overlays.css")).not.toMatch(/@keyframes kit-fade-(?:in|out)\s*\{[^}]*transform/);
  });
});
