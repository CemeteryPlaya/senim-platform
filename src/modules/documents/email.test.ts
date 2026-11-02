import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { emailProvider, partyEmail } from "./email";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
  resetEnvCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("e-mail (временный адаптер до notifications.EmailProvider)", () => {
  it("mock принимает письмо с вложением и не отправляет его", async () => {
    const provider = emailProvider();
    expect(provider.name).toBe("mock");
    const res = await provider.send({ to: "buyer@example.kz", subject: "Акт", text: "Текст", attachments: [{ fileName: "a.pdf", contentType: "application/pdf", bytes: new Uint8Array([1]) }] });
    expect(res.id).toMatch(/^mock-/);
  });

  it("e-mail стороны пока неизвестен (в профиле нет поля) — письмо не отправляется", async () => {
    expect(await partyEmail({} as never, "u1")).toBeNull();
  });
});
