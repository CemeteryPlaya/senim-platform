// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { mount, type Mounted } from "@/kit/test-utils";

const { invite, refresh, toast } = vi.hoisted(() => ({ invite: vi.fn(), refresh: vi.fn(), toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("../actions", () => ({ inviteExecutorAction: invite }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/kit", async (original) => ({ ...(await original<typeof import("@/kit")>()), toast }));

import { InviteControl } from "./InviteControl";

const t = ru.app.guest.executor.invite;
let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
  invite.mockReset();
});

const flush = () => act(async () => void (await Promise.resolve()));
const button = (label: string) => [...(mounted as Mounted).container.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const open = () => {
  mounted = mount(<InviteControl view={{ kind: "context", label: t.action(7), requestId: "r1" }} publicNumber={9} device="desktop" />);
};

describe("кнопка «Пригласить к заказу №N»", () => {
  it("нажатие отправляет приглашение с ключом повтора; успех — тот же тост и обновление экрана", async () => {
    invite.mockResolvedValue({ ok: true, data: { invitationId: "i1", created: true } });
    open();
    act(() => button(t.action(7)).click());
    await flush();
    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0]![0]).toMatchObject({ requestId: "r1", publicNumber: 9, clientKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(toast).toHaveBeenCalledWith(t.toast);
    expect(refresh).toHaveBeenCalled();
  });

  it("повтор приглашения (created: false) — тот же успешный тост «Приглашение отправлено»", async () => {
    invite.mockResolvedValue({ ok: true, data: { invitationId: "i1", created: false } });
    open();
    act(() => button(t.action(7)).click());
    await flush();
    expect(toast).toHaveBeenCalledWith(t.toast);
  });

  it("двойное нажатие, пока идёт запрос, — один вызов; после сбоя повтор идёт с тем же ключом", async () => {
    let finish: (v: unknown) => void = () => undefined;
    invite.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    open();
    act(() => {
      button(t.action(7)).click();
      button(t.action(7)).click();
    });
    expect(invite).toHaveBeenCalledTimes(1);
    finish({ ok: false, code: "INTERNAL", error: "Сбой" });
    await flush();
    await flush();
    invite.mockResolvedValue({ ok: true, data: { invitationId: "i1", created: true } });
    act(() => button(t.action(7)).click());
    await flush();
    expect(invite).toHaveBeenCalledTimes(2);
    expect(invite.mock.calls[1]![0].clientKey).toBe(invite.mock.calls[0]![0].clientKey);
  });
});
