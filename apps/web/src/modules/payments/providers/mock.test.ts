import { describe, expect, it } from "vitest";
import { mockProvider } from "./mock";

const refOf = async (idempotencyKey: string) => {
  const r = await mockProvider.getStatus({ idempotencyKey, externalRef: null });
  return r.status === "SUCCEEDED" ? r.externalRef : null;
};

describe("тестовый провайдер: номер операции", () => {
  it("как у банка — 12 цифр, без «MOCK-»: покупатель и мастер видят номер в истории денег", async () => {
    expect(await refOf("deal:d1:hold")).toMatch(/^\d{12}$/);
  });

  it("выводится из ключа идемпотентности: повтор — тот же номер, другой ключ — другой", async () => {
    expect(await refOf("deal:d1:hold")).toBe(await refOf("deal:d1:hold"));
    expect(await refOf("deal:d1:hold")).not.toBe(await refOf("deal:d1:split"));
  });
});
