// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyField, TextField } from "@/kit";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { ActionResult } from "@/platform/action";
import { useActionForm } from "./form";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

/** Отказ проверки: ошибки у цены и комментария, общий текст — первое сообщение (как у parseInput). */
const refuse = async (): Promise<ActionResult<never>> => ({
  ok: false,
  code: "VALIDATION",
  error: "Укажите цену",
  fieldErrors: { price: ["Укажите цену"], comment: ["Слишком длинно"] },
});

function Sample({ action }: { action: () => Promise<ActionResult<never>> }) {
  const form = useActionForm(action);
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <TextField label="Название" name="title" error={form.fieldErrors.title} />
      <MoneyField label="Цена" name="price" error={form.fieldErrors.price} />
      <TextField label="Комментарий" name="comment" error={form.fieldErrors.comment} />
      {form.error && <p role="status">{form.error}</p>}
    </form>
  );
}

/** Отправить форму и дождаться ответа действия (промис и перерисовка). */
async function submitAndSettle(container: HTMLElement): Promise<void> {
  submit(container.querySelector("form") as HTMLFormElement);
  await act(async () => {
    await Promise.resolve();
  });
}

const byLabel = (container: HTMLElement, label: string): HTMLInputElement => {
  const id = [...container.querySelectorAll("label")].find((l) => l.textContent === label)?.htmlFor;
  const el = id ? container.ownerDocument.getElementById(id) : null;
  if (!(el instanceof HTMLInputElement)) throw new Error(`нет поля «${label}»`);
  return el;
};

describe("useActionForm в браузере: ошибки у полей", () => {
  it("после отказа — фокус и прокрутка к первому полю с ошибкой, один раз на отправку", async () => {
    mounted = mount(<Sample action={refuse} />);
    // После mount: заглушку прокрутки ставит mount (в jsdom её нет).
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const { container } = mounted;
    await submitAndSettle(container);

    const price = byLabel(container, "Цена");
    expect(price.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(price);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(price);

    // Перерисовки после правки (снятие ошибки) фокус не переносят и не прокручивают снова.
    edit(byLabel(container, "Название"), "Шкаф", { inputType: "insertFromPaste", data: "Шкаф" });
    edit(price, "5", { data: "5" });
    expect(scroll).toHaveBeenCalledTimes(1);

    // Новая отправка с отказом — снова к первому полю с ошибкой.
    await submitAndSettle(container);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("правка поля снимает его ошибку и общий текст с тем же сообщением; ошибка другого поля остаётся", async () => {
    mounted = mount(<Sample action={refuse} />);
    const { container } = mounted;
    await submitAndSettle(container);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Укажите цену");

    const price = byLabel(container, "Цена");
    edit(price, "12", { inputType: "insertFromPaste", data: "12" });
    expect(price.getAttribute("aria-invalid")).toBeNull();
    // Набранное не потерялось при перерисовке (обработчик формы срабатывает после React).
    expect(price.value).toBe("12");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(byLabel(container, "Комментарий").getAttribute("aria-invalid")).toBe("true");
  });

  it("набор в обычное поле после отказа сохраняется", async () => {
    mounted = mount(<Sample action={refuse} />);
    const { container } = mounted;
    await submitAndSettle(container);
    const comment = byLabel(container, "Комментарий");
    edit(comment, "Коротко", { inputType: "insertFromPaste", data: "Коротко" });
    expect(comment.value).toBe("Коротко");
    expect(comment.getAttribute("aria-invalid")).toBeNull();
  });
});
