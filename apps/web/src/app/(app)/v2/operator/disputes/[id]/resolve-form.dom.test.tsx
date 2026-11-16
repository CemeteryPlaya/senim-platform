// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { ActionResult } from "@/platform/action";

const { resolve, preview, refresh, replace } = vi.hoisted(() => ({ resolve: vi.fn(), preview: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("../actions", () => ({ resolveDisputeAction: resolve, previewSplitAction: preview }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }), usePathname: () => "/v2/operator/disputes/d1" }));
vi.mock("../../mfa/actions", () => ({ verifySecondFactorAction: vi.fn(async () => ({ ok: true, data: undefined })) }));

import { ResolveForm } from "./ResolveForm";
import { ResolvedSection } from "./ResolvedSection";

const t = ru.app.operatorDisputes;
const d = t.decision;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
  resolve.mockReset();
  preview.mockReset();
});

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
const show = (): HTMLDivElement => (mounted as Mounted).container;
const button = (label: string) => [...show().querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const radio = (value: string) => show().querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`) as HTMLInputElement;
const share = () => show().querySelector<HTMLInputElement>('input[data-field="masterShareKzt"]') as HTMLInputElement;

/** Текст в многострочное поле, как после ввода: значение мимо отслеживания React и событие `input`. */
function typeInto(area: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  });
}

function open(): void {
  mounted = mount(<ResolveForm disputeId="d1" maxTiyn={100_000_000n} buyerTotalTiyn={102_000_000n} mobile={false} />);
}

function pickSplit(): void {
  act(() => radio("PARTIAL_SPLIT").click());
}

describe("форма решения спора", () => {
  it("по умолчанию — «продолжить работу», поля суммы нет; раздел показывает поле суммы и подсказку с потолком", () => {
    open();
    expect(radio("CONTINUE").checked).toBe(true);
    expect(share()).toBeNull();
    pickSplit();
    expect(share()).not.toBeNull();
    expect(show().textContent).toContain(d.shareHint(formatMoney(100_000_000n)));
    expect(show().textContent).toContain(d.previewWaiting);
  });

  it("расчёт раздела: сервер получает тенге цифрами, ответ — три суммы; правка суммы делает расчёт устаревшим", async () => {
    preview.mockResolvedValue({ ok: true, data: { shareTiyn: "6000000", masterTiyn: "5760000", platformTiyn: "240000", refundTiyn: "4000000" } } satisfies ActionResult<unknown>);
    open();
    pickSplit();
    edit(share(), "60000", { data: "60000" });
    act(() => button(d.previewButton).click());
    await settle();

    expect(preview).toHaveBeenCalledWith({ disputeId: "d1", masterShareKzt: "60000" });
    const text = show().textContent ?? "";
    expect(text).toContain(d.previewMaster);
    expect(text).toContain(formatMoney(5_760_000n));
    expect(text).toContain(formatMoney(240_000n));
    expect(text).toContain(formatMoney(4_000_000n));

    edit(share(), "70000", { data: "0" });
    expect(show().textContent).toContain(d.previewStale);
    expect(show().textContent).not.toContain(formatMoney(5_760_000n));
  });

  it("расчёт без суммы — ошибка у поля, сервер не вызывается; отказ сервера — ошибка у поля суммы", async () => {
    open();
    pickSplit();
    act(() => button(d.previewButton).click());
    await settle();
    expect(preview).not.toHaveBeenCalled();
    expect(show().textContent).toContain(d.shareRequired);

    preview.mockResolvedValue({ ok: false, code: "VALIDATION", error: "Сумма больше цены", fieldErrors: { masterShareKzt: ["Сумма больше цены"] } } satisfies ActionResult<unknown>);
    edit(share(), "9999999", { data: "9" });
    act(() => button(d.previewButton).click());
    await settle();
    expect(show().textContent).toContain("Сумма больше цены");
  });

  const PREVIEW = { ok: true, data: { shareTiyn: "6000000", masterTiyn: "5760000", platformTiyn: "240000", refundTiyn: "4000000" } } satisfies ActionResult<unknown>;
  const submitForm = () => submit(show().querySelector("form") as HTMLFormElement);
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  const dialogButton = (label: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  const write = (text: string) => typeInto(show().querySelector("textarea") as HTMLTextAreaElement, text);

  async function fillSplit(): Promise<void> {
    preview.mockResolvedValue(PREVIEW);
    pickSplit();
    edit(share(), "60000", { data: "0" });
    act(() => button(d.previewButton).click());
    await settle();
    write("Сделана половина работы");
  }

  it("«продолжить работу» — без окна подтверждения: решение уходит сразу", async () => {
    resolve.mockResolvedValue({ ok: true, data: undefined });
    open();
    write("Дефект устранён на месте");
    submitForm();
    await settle();
    expect(dialog()).toBeNull();
    expect(resolve).toHaveBeenCalledWith({ disputeId: "d1", outcome: "CONTINUE", rationale: "Дефект устранён на месте" });
    expect(replace).toHaveBeenCalledWith("/v2/operator/disputes/d1?resolved=1");
  });

  it("полный возврат — окно с суммой к возврату; «Не сейчас» — действия нет; подтверждение — решение уходит", async () => {
    resolve.mockResolvedValue({ ok: true, data: undefined });
    open();
    act(() => radio("FULL_REFUND").click());
    write("Работа не соответствует оферте");
    submitForm();
    await settle();
    expect(resolve).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain(d.confirm.FULL_REFUND.body(formatMoney(102_000_000n)));

    act(() => dialogButton(d.confirm.cancel).click());
    await settle();
    expect(resolve).not.toHaveBeenCalled();

    submitForm();
    await settle();
    act(() => dialogButton(d.confirm.FULL_REFUND.action).click());
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ disputeId: "d1", outcome: "FULL_REFUND", rationale: "Работа не соответствует оферте" });
  });

  it("раздел без расчёта — окна нет, у поля просьба рассчитать; расчёт устарел (сумму правили) — то же", async () => {
    open();
    pickSplit();
    edit(share(), "60000", { data: "0" });
    write("Сделана половина работы");
    submitForm();
    await settle();
    expect(dialog()).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(show().textContent).toContain(d.previewFirst);

    preview.mockResolvedValue(PREVIEW);
    act(() => button(d.previewButton).click());
    await settle();
    edit(share(), "70000", { data: "0" });
    submitForm();
    await settle();
    expect(dialog()).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(show().textContent).toContain(d.previewFirst);
  });

  it("раздел по расчёту: окно показывает суммы из расчёта; подтверждение → код по MFA_REQUIRED → повтор без второго окна", async () => {
    resolve.mockResolvedValueOnce({ ok: false, code: "MFA_REQUIRED", error: ru.identity.mfa.stepUp }).mockResolvedValueOnce({ ok: true, data: undefined });
    open();
    await fillSplit();
    submitForm();
    await settle();
    const text = dialog()?.textContent ?? "";
    expect(text).toContain(formatMoney(5_760_000n));
    expect(text).toContain(formatMoney(240_000n));
    expect(text).toContain(formatMoney(4_000_000n));
    expect(resolve).not.toHaveBeenCalled();

    act(() => dialogButton(d.confirm.PARTIAL_SPLIT.action).click());
    await settle();
    // Окно было до кода: действие вызвано, сервер просит код, поле кода появилось, окна больше нет.
    expect(resolve).toHaveBeenCalledWith({ disputeId: "d1", outcome: "PARTIAL_SPLIT", masterShareKzt: "60000", rationale: "Сделана половина работы" });
    const code = show().querySelector<HTMLInputElement>('input[name="mfaCode"]');
    expect(code).not.toBeNull();

    edit(code as HTMLInputElement, "123456", { data: "123456" });
    submitForm();
    await settle();
    // Повтор ушёл сразу с кода, без нового окна подтверждения (подтверждено до кода).
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("ошибка обоснования — у поля, один раз (общей плашки нет)", async () => {
    resolve.mockResolvedValue({ ok: false, code: "VALIDATION", error: "Напишите обоснование", fieldErrors: { rationale: ["Напишите обоснование"] } } satisfies ActionResult<unknown>);
    open();
    submitForm();
    await settle();
    expect((show().textContent ?? "").split("Напишите обоснование")).toHaveLength(2);
    expect(show().querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("раздел «Решение принято»", () => {
  it("после решения (focus) заголовок принимает фокус; без признака — нет", () => {
    mounted = mount(<ResolvedSection title="Решение принято" focus>итог</ResolvedSection>);
    const heading = show().querySelector("h2") as HTMLElement;
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
    mounted.unmount();
    mounted = mount(<ResolvedSection title="Решение принято" focus={false}>итог</ResolvedSection>);
    expect(document.activeElement).toBe(document.body);
  });
});
