import { describe, expect, it } from "vitest";
import { chatClosedReason } from "./chat-policy";

describe("chatClosedReason: когда в чат больше нельзя писать", () => {
  it.each([
    [{ offerStatus: "SENT", requestStatus: "OPEN", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "OFFER_CHOSEN", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "MEASURING", dealStatus: null }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CONTRACTING", dealStatus: "AWAITING_SIGNATURES" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "IN_PROGRESS" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "DISPUTE" }, null],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "COMPLETED" }, null],
    [{ offerStatus: "WITHDRAWN", requestStatus: "OPEN", dealStatus: null }, "offerWithdrawn"],
    [{ offerStatus: "DECLINED", requestStatus: "OFFER_CHOSEN", dealStatus: null }, "offerDeclined"],
    [{ offerStatus: "SENT", requestStatus: "CANCELLED", dealStatus: null }, "requestCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CANCELLED", dealStatus: null }, "requestCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "CANCELLED" }, "dealCancelled"],
    [{ offerStatus: "ACCEPTED", requestStatus: "CLOSED", dealStatus: "TERMINATED" }, "dealTerminated"],
  ] as const)("%o → %s", (state, expected) => {
    expect(chatClosedReason(state)).toBe(expected);
  });
});
