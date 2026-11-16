// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeField } from "./CodeField";
import { edit, mount, paste, submit, type Mounted } from "./test-utils";
import { EMAIL_SUGGEST_PAUSE_MS, EmailField } from "./EmailField";
import { IinField } from "./IinField";
import { MoneyField } from "./MoneyField";
import { PhoneField } from "./PhoneField";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

const visibleInput = (container: HTMLElement): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (!el) throw new Error("нет видимого поля");
  return el;
};
const hidden = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;

describe("CodeField: автоотправка", () => {
  function renderCode() {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    mounted = mount(
      <form>
        <CodeField label="Код" name="code" autoSubmit />
      </form>,
    );
    return { input: visibleInput(mounted.container), requestSubmit };
  }

  it("набор до последней цифры — ровно один requestSubmit; тот же код ещё раз — без вызова", () => {
    const { input, requestSubmit } = renderCode();
    for (const [i, ch] of [..."12345"].entries()) edit(input, "12345".slice(0, i + 1), { data: ch });
    expect(requestSubmit).not.toHaveBeenCalled();
    edit(input, "123456", { data: "6" });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    // Повторное событие с тем же кодом (подстановка, ошибка проверки) — код не уходит снова.
    edit(input, "123456", { inputType: "insertReplacementText", data: "123456" });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    // Изменённый код — новая попытка.
    edit(input, "123457", { data: "7" });
    expect(requestSubmit).toHaveBeenCalledTimes(2);
  });

  it("вставка «123 456» целиком — отправка", () => {
    const { input, requestSubmit } = renderCode();
    edit(input, "123 456", { inputType: "insertFromPaste", data: "123 456" });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("без autoSubmit — не отправляет", () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    mounted = mount(
      <form>
        <CodeField label="Код" name="code" />
      </form>,
    );
    edit(visibleInput(mounted.container), "123456", { inputType: "insertFromPaste", data: "123456" });
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});

describe("MaskedField: курсор и вставка", () => {
  it("телефон: цифра в середине — показ перестроен, курсор сразу после неё, в форму — +7…", () => {
    mounted = mount(<PhoneField label="Телефон" name="phone" defaultValue="70012345" />);
    const input = visibleInput(mounted.container);
    expect(input.value).toBe("700 123 45");
    input.focus();
    // «700 12|3 45» → набрали «9».
    edit(input, "700 1293 45", { caret: 7, data: "9" });
    expect(input.value).toBe("700 129 34 5");
    expect(input.selectionStart).toBe(7);
    expect(hidden(mounted.container, "phone")).toBe("+7700129345");
  });

  it("телефон: Backspace сразу после пробела стирает цифру перед ним", () => {
    mounted = mount(<PhoneField label="Телефон" name="phone" defaultValue="700123" />);
    const input = visibleInput(mounted.container);
    input.focus();
    edit(input, "700123", { caret: 3, inputType: "deleteContentBackward" });
    expect(input.value).toBe("701 23");
    expect(input.selectionStart).toBe(2);
  });

  it("деньги: вставка «1,2 млн» — показ с разрядами, в форму целые тенге, экрану — тиыны", () => {
    const onValueChange = vi.fn();
    mounted = mount(<MoneyField label="Цена" name="price" onValueChange={onValueChange} />);
    const input = visibleInput(mounted.container);
    input.focus();
    expect(paste(input, "1,2 млн")).toBe(false);
    expect(input.value).toBe("1 200 000");
    expect(hidden(mounted.container, "price")).toBe("1200000");
    expect(onValueChange).toHaveBeenLastCalledWith(120_000_000n);
  });

  it("деньги: ноль — экрану null (расчёта нет)", () => {
    const onValueChange = vi.fn();
    mounted = mount(<MoneyField label="Цена" name="price" onValueChange={onValueChange} />);
    edit(visibleInput(mounted.container), "0", { data: "0" });
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });
});

describe("EmailField: подсказка опечатки", () => {
  it("отправка с опечаткой останавливается и показывает подсказку; повторная без выбора — уходит как есть", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    mounted = mount(
      <form onSubmit={onSubmit}>
        <EmailField label="Почта" name="email" defaultValue="aigerim@gmial.com" />
      </form>,
    );
    const form = mounted.container.querySelector("form");
    if (!form) throw new Error("нет формы");
    submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain("Возможно, вы имели в виду aigerim@gmail.com?");
    submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("пауза в наборе — подсказка; нажатие подставляет адрес", () => {
    vi.useFakeTimers();
    try {
      mounted = mount(<EmailField label="Почта" name="email" />);
      const input = visibleInput(mounted.container);
      edit(input, "a@mail.ri", { data: "i" });
      expect(mounted.container.querySelector("button")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(EMAIL_SUGGEST_PAUSE_MS);
      });
      const button = mounted.container.querySelector("button");
      expect(button?.textContent).toBe("Возможно, вы имели в виду a@mail.ru?");
      act(() => button?.click());
      expect(input.value).toBe("a@mail.ru");
      expect(mounted.container.querySelector("button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("корректный адрес — отправка без остановки", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    mounted = mount(
      <form onSubmit={onSubmit}>
        <EmailField label="Почта" name="email" defaultValue="a@company.kz" />
      </form>,
    );
    submit(mounted.container.querySelector("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("IinField: ошибка при уходе с поля не сдвигает кнопку из-под щелчка", () => {
  /** Событие указателя (в jsdom PointerEvent может не быть): тип, номер указателя, нажатые кнопки. */
  function pointer(target: Element, type: string, buttons: number): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, buttons: { value: buttons } });
    act(() => {
      target.dispatchEvent(event);
    });
  }
  /** Уход с поля (в jsdom фокус не переносится сам); `relatedTarget` — null, как в Safari при щелчке по кнопке. */
  function blur(input: HTMLInputElement): void {
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
  }
  const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  function renderIin() {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    mounted = mount(
      <form onSubmit={onSubmit}>
        <IinField label="ИИН" name="iin" />
        <button type="submit">Продолжить</button>
      </form>,
    );
    const input = visibleInput(mounted.container);
    edit(input, "123", { data: "3" });
    const button = mounted.container.querySelector("button");
    if (!button) throw new Error("нет кнопки");
    return { container: mounted.container, input, button, onSubmit };
  }

  it("уход без нажатия (Tab) — ошибка у поля сразу", () => {
    const { container, input } = renderIin();
    blur(input);
    expect(container.textContent).toContain("ИИН — 12 цифр");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("pointerdown → blur → pointerup → click: форма отправилась, ошибка появилась после щелчка", async () => {
    const { container, input, button, onSubmit } = renderIin();
    pointer(button, "pointerdown", 1);
    blur(input);
    expect(container.textContent).not.toContain("ИИН — 12 цифр");
    pointer(button, "pointerup", 0);
    act(() => button.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("ИИН — 12 цифр");
    await nextFrame();
    expect(container.textContent).toContain("ИИН — 12 цифр");
  });

  it("отпустили за окном (pointerup не пришёл): движение без нажатых кнопок показывает ошибку", async () => {
    const { container, input, button } = renderIin();
    pointer(button, "pointerdown", 1);
    blur(input);
    pointer(document.body, "pointermove", 0);
    await nextFrame();
    expect(container.textContent).toContain("ИИН — 12 цифр");
  });
});
