import { describe, expect, it } from "vitest";
import { chatClosedReason, CHAT_MODERATION, moderationTarget } from "./chat-policy";

describe("chatClosedReason: когда в чат больше нельзя писать", () => {
  it.each([
    [{ offerStatus: "SENT", requestStatus: "OPEN", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "OFFER_CHOSEN", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "MEASURING", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CONTRACTING", dealStatus: "CREATED" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "PAID_HOLD" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "IN_PROGRESS" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "READY" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "ACCEPTED" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "SPLIT_PAYOUT" }, null],
    [{ offerStatus: "WITHDRAWN", requestStatus: "OPEN", dealStatus: null }, "offerWithdrawn"],
    [{ offerStatus: "DECLINED", requestStatus: "OFFER_CHOSEN", dealStatus: null }, "offerDeclined"],
    [{ offerStatus: "SENT", requestStatus: "CANCELLED", dealStatus: null }, "requestCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CANCELLED", dealStatus: null }, "requestCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "CANCELLED" }, "dealCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "REFUNDED" }, "dealRefunded"],
  ] as const)("%o → %s", (state, expected) => {
    expect(chatClosedReason({ ...state, closedByOperator: false })).toBe(expected);
  });

  it("закрыт оператором — закрыт при любом состоянии сделки, в том числе после завершения (№19)", () => {
    expect(chatClosedReason({ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "SPLIT_PAYOUT", closedByOperator: true })).toBe("operatorClosed");
    expect(chatClosedReason({ offerStatus: "SENT", requestStatus: "OPEN", dealStatus: null, closedByOperator: true })).toBe("operatorClosed");
  });
});

describe("закрытие чата оператором: таблица переходов", () => {
  it("закрыть можно открытый, открыть снова — закрытый; только оператор", () => {
    expect(CHAT_MODERATION).toEqual({
      close: { from: "OPEN", to: "CLOSED", who: "OPERATOR" },
      reopen: { from: "CLOSED", to: "OPEN", who: "OPERATOR" },
    });
    expect(moderationTarget("close", "OPEN", "OPERATOR")).toBe("CLOSED");
    expect(moderationTarget("reopen", "CLOSED", "OPERATOR")).toBe("OPEN");
  });

  it.each([
    ["close", "CLOSED", "OPERATOR", "CONFLICT"],
    ["reopen", "OPEN", "OPERATOR", "CONFLICT"],
    ["close", "OPEN", "CLIENT", "FORBIDDEN"],
    ["close", "OPEN", "EXECUTOR", "FORBIDDEN"],
    ["reopen", "CLOSED", "CLIENT", "FORBIDDEN"],
    ["reopen", "CLOSED", "EXECUTOR", "FORBIDDEN"],
  ] as const)("%s из %s ролью %s — %s", (action, from, who, code) => {
    expect(() => moderationTarget(action, from, who)).toThrow(expect.objectContaining({ code }));
  });
});
