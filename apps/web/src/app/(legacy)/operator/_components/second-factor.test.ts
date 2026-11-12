import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/platform/action";
import { MFA_CODE_FIELD, runWithCode } from "./second-factor";

const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

describe("runWithCode: код из приложения, затем действие", () => {
  it("без поля кода — только действие, verify не вызывается", async () => {
    const action = vi.fn(async () => ok("done"));
    const verify = vi.fn(async () => ok(undefined));
    expect(await runWithCode({ transactionId: "t1" }, action, verify)).toEqual({ step: "action", verified: false, result: ok("done") });
    expect(verify).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledWith({ transactionId: "t1" });
  });

  it("с кодом — сначала verify, затем действие без поля кода", async () => {
    const order: string[] = [];
    const verify = vi.fn(async (input: { code: string }) => {
      order.push(`verify:${input.code}`);
      return ok(undefined);
    });
    const action = vi.fn(async (fields: Record<string, string | File>) => {
      order.push(`action:${Object.keys(fields).join(",")}`);
      return ok(1);
    });
    expect(await runWithCode({ transactionId: "t1", [MFA_CODE_FIELD]: "123456" }, action, verify)).toEqual({ step: "action", verified: true, result: ok(1) });
    expect(order).toEqual(["verify:123456", "action:transactionId"]);
  });

  it("код не принят — действие не вызывается, отказ verify наружу", async () => {
    const refusal = { ok: false as const, code: "VALIDATION" as const, error: "Неверный код", fieldErrors: { code: ["Неверный код"] } };
    const action = vi.fn(async () => ok(1));
    expect(await runWithCode({ [MFA_CODE_FIELD]: "000000" }, action, async () => refusal)).toEqual({ step: "code", result: refusal });
    expect(action).not.toHaveBeenCalled();
  });
});
