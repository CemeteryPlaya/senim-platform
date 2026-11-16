// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { DecisionQueue, QueueCard } from "@/kit";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { ActionResult } from "@/platform/action";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  review: vi.fn<(input: unknown) => Promise<ActionResult<void>>>(async () => ({ ok: true, data: undefined })),
  confirm: vi.fn<(input: unknown) => Promise<ActionResult<void>>>(async () => ({ ok: true, data: undefined })),
  verify: vi.fn<(input: { code: string }) => Promise<ActionResult<void>>>(async () => ({ ok: true, data: undefined })),
}));

vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh: h.refresh, push() {} }) }));
// Действия — server actions: в браузерном тесте подменяются; код из приложения здесь не спрашивается.
vi.mock("../mfa/actions", () => ({ verifySecondFactorAction: h.verify }));
vi.mock("../kyc/actions", () => ({ reviewKycAction: h.review }));
vi.mock("../money/actions", () => ({ confirmBankOperationAction: h.confirm, failBankOperationAction: vi.fn(), retryBankOperationAction: vi.fn() }));

const { KycDecision } = await import("../kyc/_parts/KycDecision");
const { OperationDecision } = await import("../money/_parts/OperationDecision");
const { SCAN_MAX_BYTES } = await import("../money/_parts/ScanField");

const k = ru.app.operatorQueues.kyc;
const m = ru.app.operatorQueues.money;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function KycQueue({ ids }: { ids: string[] }) {
  return (
    <DecisionQueue count={ids.length} label={k.queueLabel} empty={k.empty}>
      {ids.map((id) => (
        <QueueCard key={id} title={`Мастер ${id}`}>
          <KycDecision device="desktop" userId={id} submittedAt="2026-11-16T07:00:00.123456Z" />
        </QueueCard>
      ))}
    </DecisionQueue>
  );
}

describe("очередь документов мастеров в браузере", () => {
  it("«Документы в порядке» — решение со временем подачи, итог в role=status, обновление экрана; фокус — на соседнюю карточку", async () => {
    mounted = mount(<KycQueue ids={["a", "b", "c"]} />);
    const { container } = mounted;
    const forms = container.querySelectorAll("form");
    submit(forms[1] as HTMLFormElement);
    await settle();

    expect(h.review).toHaveBeenCalledWith({ userId: "b", submittedAt: "2026-11-16T07:00:00.123456Z", decision: "VERIFIED" });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(k.verified);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    // Экран обновился: карточки «b» нет — фокус на заголовке карточки, вставшей на её место.
    act(() => mounted?.root.render(<KycQueue ids={["a", "c"]} />));
    expect(document.activeElement?.textContent).toBe("Мастер c");
  });

  it("отказ модуля (решение уже принято) — текст у формы, итога и обновления нет", async () => {
    h.review.mockResolvedValueOnce({ ok: false, code: "CONFLICT", error: "Документы уже проверены" });
    mounted = mount(<KycQueue ids={["a"]} />);
    const { container } = mounted;
    submit(container.querySelector("form") as HTMLFormElement);
    await settle();
    expect(container.textContent).toContain("Документы уже проверены");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

/** Выбор файла в скрытом поле `Uploader` (как выбор в системном окне). */
function pick(container: HTMLElement, file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("подтверждение операции банка: скан в форме", () => {
  const card = () => (
    <DecisionQueue count={1} label={m.queueLabel} empty={m.empty}>
      <QueueCard title="Оплата">
        <OperationDecision device="desktop" transactionId="t1" type="HOLD" today="2026-11-16" />
      </QueueCard>
    </DecisionQueue>
  );

  it("выбранный скан уходит в действие вместе с номером и датой", async () => {
    mounted = mount(card());
    const { container } = mounted;
    const scan = new File(["%PDF-1.4"], "pp-17.pdf", { type: "application/pdf" });
    pick(container, scan);
    expect(container.textContent).toContain("pp-17.pdf");
    (container.querySelector('input[name="bankDocNumber"]') as HTMLInputElement).value = "ПП-17";
    submit(container.querySelector("form") as HTMLFormElement);
    await settle();

    const input = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({ transactionId: "t1", bankDocNumber: "ПП-17", bankDocDate: "2026-11-16" });
    expect(input.scan).toBe(scan);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(m.confirmed);
  });

  it("код вводили давно: MFA_REQUIRED → поле кода → проверка кода → повтор с тем же сканом и без поля кода", async () => {
    h.confirm.mockResolvedValueOnce({ ok: false, code: "MFA_REQUIRED", error: ru.identity.mfa.stepUp });
    mounted = mount(card());
    const { container } = mounted;
    const scan = new File(["%PDF-1.4"], "pp-18.pdf", { type: "application/pdf" });
    pick(container, scan);
    (container.querySelector('input[name="bankDocNumber"]') as HTMLInputElement).value = "ПП-18";
    submit(container.querySelector("form") as HTMLFormElement);
    await settle();

    const code = container.querySelector<HTMLInputElement>('input[name="mfaCode"]');
    expect(code).not.toBeNull();
    edit(code as HTMLInputElement, "123456", { data: "123456" });
    submit(container.querySelector("form") as HTMLFormElement);
    await settle();

    expect(h.verify).toHaveBeenCalledWith({ code: "123456" });
    expect(h.confirm).toHaveBeenCalledTimes(2);
    const second = h.confirm.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(second.scan).toBe(scan);
    expect(second).not.toHaveProperty("mfaCode");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(m.confirmed);
  });

  it("ошибка сервера у скана: фокус на «Выбрать скан»; выбор другого файла (и перетаскиванием, без события input) её прячет", async () => {
    h.confirm.mockResolvedValueOnce({ ok: false, code: "VALIDATION", error: m.scanRequired, fieldErrors: { scan: [m.scanRequired] } });
    mounted = mount(card());
    const { container } = mounted;
    (container.querySelector('input[name="bankDocNumber"]') as HTMLInputElement).value = "ПП-19";
    submit(container.querySelector("form") as HTMLFormElement);
    await settle();

    expect(container.textContent).toContain(m.scanRequired);
    expect(document.activeElement?.getAttribute("data-field")).toBe("scan");
    expect(document.activeElement?.textContent).toContain(m.scanPick);

    pick(container, new File(["%PDF-1.4"], "pp-19.pdf", { type: "application/pdf" }));
    expect(container.textContent).not.toContain(m.scanRequired);
  });

  it("скан больше 4 МБ — ошибка у поля сразу, файл не берётся; не тот тип — тоже", () => {
    mounted = mount(card());
    const { container } = mounted;
    pick(container, new File([new Uint8Array(SCAN_MAX_BYTES + 1)], "big.pdf", { type: "application/pdf" }));
    expect(container.textContent).toContain(m.scanTooLarge);
    expect(container.textContent).not.toContain("big.pdf");
    pick(container, new File(["x"], "scan.gif", { type: "image/gif" }));
    expect(container.textContent).toContain(m.scanType);
  });
});
