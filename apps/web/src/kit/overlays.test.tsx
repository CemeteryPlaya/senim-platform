import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { html } from "./test-utils";
import { Button, ConfirmDialog, Dialog, Explain, Popover, Sheet, Toaster } from "./index";
import { ru } from "@/i18n/ru";
import { SPRING } from "./motion";
import { createConfirmRunner, returnFocusTarget } from "./overlay-state";
import { toastClassNames } from "./Toaster";

// Статический рендер закрытого состояния: в разметке только триггер. Поведение открытого окна
// (фокус внутри и возврат на триггер, Esc, затемнение, жест шторки) проверяет e2e (задача 10).

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
    const m = html(
      <Popover label="Действия" trigger={<Button variant="quiet">Ещё</Button>}>
        Содержимое
      </Popover>,
    );
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).not.toContain("Содержимое");
    // @ts-expect-error — у поповера должно быть имя для диктора: title или label
    expect(html(<Popover trigger={<Button variant="quiet">Ещё</Button>}>Содержимое</Popover>)).toContain("Ещё");
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

  it.each(["mobile", "desktop"] as const)("Toaster (%s): область уведомлений подписана для диктора", (device) => {
    expect(html(<Toaster device={device} />)).toContain(`aria-label="${ru.app.kit.notifications}"`);
  });
});

describe("Toaster: иконка тоста", () => {
  it("позиционированная коробка 20 px: в ней центрируется .sonner-loader, а не по всему тосту", () => {
    expect(toastClassNames.icon.split(" ")).toEqual(expect.arrayContaining(["relative", "size-5", "shrink-0"]));
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

  it("overlays.css: шторка открывается и закрывается за 0,4 с (вместо 0,5 с vaul)", () => {
    const css = read("overlays.css");
    const rule = /\[data-vaul-drawer\]\[data-state\],\s*\[data-vaul-overlay\]\[data-state\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/animation-duration:\s*0\.4s\s*!important/);
    expect(rule).toMatch(/transition-duration:\s*0\.4s\s*!important/);
    // правило меньшего движения стоит позже и при равной специфичности перекрывает 0,4 с
    expect(css.indexOf("prefers-reduced-motion")).toBeGreaterThan(css.indexOf("animation-duration: 0.4s"));
  });

  it("overlays.css: кольцо фокуса тоста — наш цвет фокуса поверх CSS sonner", () => {
    const rule =
      /\[data-sonner-toaster\] \[data-sonner-toast\]:focus-visible\s*\{([^}]*)\}/.exec(read("overlays.css"))?.[1] ?? "";
    expect(rule).toMatch(/outline:\s*2px solid var\(--role-focus\)/);
    expect(rule).toMatch(/outline-offset:\s*2px/);
    expect(rule).toMatch(/box-shadow:\s*--theme\(--shadow-float\)/);
  });

  it("overlays.css: при меньшем движении переход затемнения мгновенный (не догоняет палец 0,4 с)", () => {
    const block = reduceBlock(read("overlays.css"));
    const rule = /\[data-vaul-overlay\]\[data-state\]\s*\{([^}]*)\}/.exec(block)?.[1] ?? "";
    expect(rule).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("overlays.css: шторка и затемнение проявляются, а не выезжают", () => {
    const block = reduceBlock(read("overlays.css"));
    expect(block).toMatch(/\[data-vaul-drawer\]\[data-state="open"\][\s\S]*?animation-name:\s*kit-fade-in/);
    expect(block).toMatch(/\[data-vaul-drawer\]\[data-state="closed"\][\s\S]*?animation-name:\s*kit-fade-out/);
    expect(read("overlays.css")).not.toMatch(/@keyframes kit-fade-(?:in|out)\s*\{[^}]*transform/);
  });
});

describe("createConfirmRunner: запуск → ожидание → результат", () => {
  function setup() {
    const log: string[] = [];
    const errors: unknown[] = [];
    const runner = createConfirmRunner({
      setPending: (pending) => log.push(`pending:${pending}`),
      onError: (error) => errors.push(error),
    });
    const close = () => log.push("close");
    return { runner, log, errors, close };
  }

  it("успех (ничего или true) закрывает окно; ожидание снимается до закрытия", async () => {
    const { runner, log, close } = setup();
    await runner.run(() => {}, close);
    expect(log).toEqual(["pending:true", "pending:false", "close"]);
    const second = setup();
    await second.runner.run(async () => true, second.close);
    expect(second.log).toContain("close");
  });

  it("false оставляет окно открытым", async () => {
    const { runner, log, close } = setup();
    await runner.run(() => false, close);
    await runner.run(async () => false, close);
    expect(log).not.toContain("close");
    expect(log.at(-1)).toBe("pending:false");
  });

  it("исключение и отклонённый промис: окно открыто, ошибка не пробрасывается, а уходит в onError", async () => {
    const { runner, log, errors, close } = setup();
    const boom = new Error("boom");
    await expect(
      runner.run(() => {
        throw boom;
      }, close),
    ).resolves.toBeUndefined();
    await expect(runner.run(() => Promise.reject(boom), close)).resolves.toBeUndefined();
    expect(errors).toEqual([boom, boom]);
    expect(log).not.toContain("close");
    expect(runner.running).toBe(false);
  });

  it("повторный запуск во время ожидания игнорируется", async () => {
    const { runner, log, close } = setup();
    let finish: () => void = () => {};
    let calls = 0;
    const action = () =>
      new Promise<void>((resolve) => {
        calls += 1;
        finish = resolve;
      });
    const first = runner.run(action, close);
    expect(runner.running).toBe(true);
    await runner.run(action, close);
    expect(calls).toBe(1);
    finish();
    await first;
    expect(log).toEqual(["pending:true", "pending:false", "close"]);
    expect(runner.running).toBe(false);
  });
});

describe("returnFocusTarget: куда вернуть фокус после окна без триггера", () => {
  const el = (isConnected: boolean) => ({ isConnected }) as HTMLElement;

  it("названный вызывающим элемент важнее запомненного (окно из пункта меню: запомнить было нечего)", () => {
    const menuButton = el(true);
    expect(returnFocusTarget(menuButton, el(true))).toBe(menuButton);
    expect(returnFocusTarget(menuButton, null)).toBe(menuButton);
  });

  it("названный ушёл со страницы — запомненный, если он на месте", () => {
    const remembered = el(true);
    expect(returnFocusTarget(el(false), remembered)).toBe(remembered);
  });

  it("некуда возвращать — null (фокус останется на body)", () => {
    expect(returnFocusTarget(null, null)).toBeNull();
    expect(returnFocusTarget(el(false), el(false))).toBeNull();
  });
});
