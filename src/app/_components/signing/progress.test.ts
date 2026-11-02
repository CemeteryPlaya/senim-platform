import { describe, expect, it } from "vitest";
import { signatureProgress } from "./state";

const at = new Date(0);

describe("signatureProgress — «Подписи: N из M» в разделе «Документы»", () => {
  it("считает только требуемые подписи обеих сторон", () => {
    expect(
      signatureProgress({
        parties: [
          { party: "CLIENT", required: { hand: true, ecp: true }, hand: { signedAt: at, documentSha256: "a", typed: false }, ecp: null },
          { party: "EXECUTOR", required: { hand: false, ecp: true }, hand: null, ecp: { signedAt: at, signedSha256: "a", method: "MOCK" } },
        ],
      }),
    ).toEqual({ done: 2, total: 3 });
    expect(signatureProgress({ parties: [] })).toEqual({ done: 0, total: 0 });
  });
});
