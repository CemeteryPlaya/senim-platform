// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { mount, type Mounted } from "@/kit/test-utils";

// Загрузка не завершается: проверяется только отметка, а не путь файла в хранилище.
vi.mock("./actions", () => ({ saveStepAction: vi.fn() }));
vi.mock("../../_upload/actions", () => ({
  createUploadAction: vi.fn(() => new Promise(() => undefined)),
  finalizeUploadAction: vi.fn(),
  discardUploadAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

import { WizardRoom } from "./WizardRoom";

const d = ru.app.requests.wizard.room.design;
const base = { draftId: "r1", like: null, executor: null, index: 2, back: { href: "/v2/requests/new?draft=r1&step=segment", label: "Назад" }, direct: null };
const saved = [
  { id: "f1", src: "/f/f1.pdf", kind: "pdf" as const, n: 1 },
  { id: "f2", src: "/f/f2.pdf", kind: "pdf" as const, n: 2 },
];

let mounted: Mounted | null = null;
beforeEach(() => {
  // jsdom не создаёт адреса blob: — загрузчику нужен только какой-то адрес превью.
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

const container = () => (mounted as Mounted).container;
const checkbox = () => container().querySelector<HTMLInputElement>('input[type="checkbox"][name="designContactsConfirmed"]');
/** Выбор файлов в загрузчике проекта (его `accept` принимает PDF). */
function pick(file: File) {
  const input = container().querySelector<HTMLInputElement>('input[type="file"][accept*="application/pdf"]');
  if (!input) throw new Error("нет выбора файлов проекта");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
}
const removeButton = (name: string) =>
  [...container().querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes(name)) as HTMLButtonElement;

describe("шаг «Помещение»: отметка о контактах в файлах проекта", () => {
  it("сохранённая отметка стоит; новый файл проекта снимает её — нужно подтвердить заново", async () => {
    mounted = mount(<WizardRoom base={base} photos={[]} description="" design={saved} designConfirmed />);
    expect(checkbox()?.checked).toBe(true);

    pick(new File(["%PDF"], "план.pdf", { type: "application/pdf" }));
    await act(async () => void (await Promise.resolve()));

    expect(checkbox()?.checked).toBe(false);
    act(() => checkbox()?.click());
    expect(checkbox()?.checked).toBe(true);
  });

  it("удаление файла проекта отметку не снимает", () => {
    mounted = mount(<WizardRoom base={base} photos={[]} description="" design={saved} designConfirmed />);
    act(() => removeButton(d.pdf(1)).click());
    expect(checkbox()?.checked).toBe(true);
  });

  it("без файлов отметки нет; первый файл — отметка не стоит", async () => {
    mounted = mount(<WizardRoom base={base} photos={[]} description="" design={[]} designConfirmed={false} />);
    expect(checkbox()).toBeNull();
    pick(new File(["%PDF"], "план.pdf", { type: "application/pdf" }));
    await act(async () => void (await Promise.resolve()));
    expect(checkbox()?.checked).toBe(false);
  });
});
