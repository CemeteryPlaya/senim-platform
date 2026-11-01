import { describe, expect, it } from "vitest";
import { familyOf, retryableKeys, retryVerdict, stillDue, type RetryFacts, type RetryOp } from "./retry-policy";

const facts = (over: Partial<RetryFacts> = {}): RetryFacts => ({
  dealStatus: "IN_PROGRESS",
  stages: [{ id: "s1", status: "ACCEPTED", payment: { status: "DUE" } }],
  dispute: null,
  ...over,
});
const resolved = (decision: "TERMINATE" | "PARTIAL" | "FAVOR_EXECUTOR" | "FAVOR_CLIENT", decisionAmount: number | null = null) => ({
  id: "d1",
  stageId: "s1",
  status: "RESOLVED" as const,
  decision,
  decisionAmount,
});
const open = (stageId: string | null) => ({ id: "d1", stageId, status: "OPEN" as const, decision: null, decisionAmount: null });
const failed = (idempotencyKey: string, kind: RetryOp["kind"] = "RELEASE"): RetryOp => ({ idempotencyKey, kind, status: "FAILED" });

describe("повтор транша этапа release:<stageId>", () => {
  it("должен быть выполнен: сделка в работе или в споре, этап принят, оплата DUE", () => {
    expect(stillDue("release:s1", "RELEASE", facts())).toBe(true);
    expect(stillDue("release:s1", "RELEASE", facts({ dealStatus: "DISPUTE" }))).toBe(true);
  });

  it("не нужен: сделка расторгнута, этап не принят, оплата уже подтверждена, чужой этап", () => {
    expect(stillDue("release:s1", "RELEASE", facts({ dealStatus: "TERMINATED" }))).toBe(false);
    expect(stillDue("release:s1", "RELEASE", facts({ stages: [{ id: "s1", status: "REWORK", payment: { status: "DUE" } }] }))).toBe(false);
    expect(stillDue("release:s1", "RELEASE", facts({ stages: [{ id: "s1", status: "ACCEPTED", payment: { status: "CONFIRMED" } }] }))).toBe(false);
    expect(stillDue("release:s2", "RELEASE", facts())).toBe(false);
  });

  it("не нужен, пока по этому этапу открыт спор: решение может отдать деньги заказчику", () => {
    expect(stillDue("release:s1", "RELEASE", facts({ dealStatus: "DISPUTE", dispute: open("s1") }))).toBe(false);
    const op = failed("release:s1");
    expect(retryVerdict(op, [op], facts({ dealStatus: "DISPUTE", dispute: open("s1") }))).toBe("notDue");
    expect([...retryableKeys([op], facts({ dealStatus: "DISPUTE", dispute: open("s1") }))]).toEqual([]);
    // Спор без этапа — о сделке целиком.
    expect(stillDue("release:s1", "RELEASE", facts({ dealStatus: "DISPUTE", dispute: open(null) }))).toBe(false);
  });

  it("спор о другом этапе или уже решённый спор по этапу повтор не блокирует", () => {
    expect(stillDue("release:s1", "RELEASE", facts({ dealStatus: "DISPUTE", dispute: open("s2") }))).toBe(true);
    expect(stillDue("release:s1", "RELEASE", facts({ dispute: resolved("FAVOR_EXECUTOR") }))).toBe(true);
  });
});

describe("операции решения по спору dispute:<id>:*", () => {
  const terminated = (d: RetryFacts["dispute"]) => facts({ dealStatus: "TERMINATED", dispute: d });

  it("возврат нужен при расторжении и частичном решении", () => {
    expect(stillDue("dispute:d1:refund", "REFUND", terminated(resolved("TERMINATE")))).toBe(true);
    expect(stillDue("dispute:d1:refund", "REFUND", terminated(resolved("PARTIAL", 5_000)))).toBe(true);
  });

  it("перечисление нужно только при частичном решении с суммой", () => {
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("PARTIAL", 5_000)))).toBe(true);
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("TERMINATE")))).toBe(false);
  });

  it("не нужен: спор другой, не решён или сделка не расторгнута", () => {
    expect(stillDue("dispute:d2:refund", "REFUND", terminated(resolved("TERMINATE")))).toBe(false);
    expect(stillDue("dispute:d1:refund", "REFUND", terminated({ ...resolved("TERMINATE"), status: "OPEN" }))).toBe(false);
    expect(stillDue("dispute:d1:refund", "REFUND", facts({ dispute: resolved("FAVOR_EXECUTOR") }))).toBe(false);
  });
});

describe("возвраты после отмены", () => {
  it("cancel:<dealId>:refund — только по отменённой сделке", () => {
    expect(stillDue("cancel:x:refund", "REFUND", facts({ dealStatus: "CANCELLED" }))).toBe(true);
    expect(stillDue("cancel:x:refund", "REFUND", facts())).toBe(false);
  });

  it("возврат пополнения, пришедшего после отмены или расторжения", () => {
    expect(stillDue("deposit:e1:refund", "REFUND", facts({ dealStatus: "TERMINATED" }))).toBe(true);
    expect(stillDue("deposit:e1:refund", "REFUND", facts())).toBe(false);
  });
});

describe("семейство ключей", () => {
  it("повтор запрещён, пока в семействе есть операция в пути или выполненная", () => {
    const op = failed("release:s1");
    expect(retryVerdict(op, [op, { idempotencyKey: "release:s1:retry:1", kind: "RELEASE", status: "PENDING" }], facts())).toBe("inProgress");
    expect(retryVerdict({ ...op, status: "SUCCEEDED" }, [op], facts())).toBe("notFailed");
    expect(retryVerdict(failed("open:x", "DEPOSIT"), [], facts())).toBe("notFailed");
  });

  it("экран: ключ повтора только у последней операции семейства и только если операция нужна", () => {
    const ops = [failed("release:s1"), failed("release:s1:retry:1"), failed("dispute:d1:refund", "REFUND")];
    expect([...retryableKeys(ops, facts())]).toEqual(["release:s1:retry:1"]);
    expect([...retryableKeys(ops, facts({ dealStatus: "TERMINATED", dispute: resolved("TERMINATE") }))]).toEqual(["dispute:d1:refund"]);
    expect([...retryableKeys([...ops, { idempotencyKey: "release:s1:retry:2", kind: "RELEASE", status: "SUCCEEDED" }], facts())]).toEqual([]);
  });
});

describe("граничные случаи правила повтора", () => {
  const terminated = (d: RetryFacts["dispute"]) => facts({ dealStatus: "TERMINATED", dispute: d });

  it("пополнение не повторяется ни в каком семействе", () => {
    for (const key of ["release:s1", "dispute:d1:refund", "cancel:x:refund", "deposit:e1:refund"]) {
      expect(stillDue(key, "DEPOSIT", terminated(resolved("TERMINATE")))).toBe(false);
      expect(stillDue(key, "DEPOSIT", facts({ dealStatus: "CANCELLED" }))).toBe(false);
      expect(stillDue(key, "DEPOSIT", facts())).toBe(false);
    }
  });

  it("транш этапа: только RELEASE и только с оплатой DUE", () => {
    expect(stillDue("release:s1", "REFUND", facts())).toBe(false);
    expect(stillDue("release:s1", "RELEASE", facts({ stages: [{ id: "s1", status: "ACCEPTED", payment: null }] }))).toBe(false);
    for (const dealStatus of ["AWAITING_SIGNATURES", "AWAITING_DEPOSIT", "COMPLETED", "CANCELLED"] as const) {
      expect(stillDue("release:s1", "RELEASE", facts({ dealStatus }))).toBe(false);
    }
  });

  it("ключ распознаётся только целиком", () => {
    expect(stillDue("xrelease:s1", "RELEASE", facts())).toBe(false);
    expect(stillDue("dispute:d1:releasex", "RELEASE", terminated(resolved("PARTIAL", 5_000)))).toBe(false);
    // не ключ спора — значит, возврат пополнения: по отменённой сделке он нужен
    expect(stillDue("xdispute:d1:refund", "REFUND", facts({ dealStatus: "CANCELLED", dispute: resolved("TERMINATE") }))).toBe(true);
  });

  it("решение по спору: вид операции, статус сделки и спора должны совпасть", () => {
    expect(stillDue("dispute:d1:refund", "RELEASE", terminated(resolved("PARTIAL", 5_000)))).toBe(false);
    expect(stillDue("dispute:d1:release", "REFUND", terminated(resolved("PARTIAL", 5_000)))).toBe(false);
    expect(stillDue("dispute:d1:refund", "REFUND", facts({ dealStatus: "IN_PROGRESS", dispute: resolved("TERMINATE") }))).toBe(false);
    expect(stillDue("dispute:d1:refund", "REFUND", terminated(null))).toBe(false);
  });

  it("перечисление по частичному решению: сумма должна быть больше нуля", () => {
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("PARTIAL", 0)))).toBe(false);
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("PARTIAL", null)))).toBe(false);
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("PARTIAL", 1)))).toBe(true);
    expect(stillDue("dispute:d1:release", "RELEASE", terminated(resolved("TERMINATE", 5_000)))).toBe(false);
  });

  it("возврат по решению: только расторжение или частичное решение", () => {
    expect(stillDue("dispute:d1:refund", "REFUND", terminated(resolved("FAVOR_CLIENT")))).toBe(false);
    expect(stillDue("dispute:d1:refund", "REFUND", terminated(resolved("FAVOR_EXECUTOR")))).toBe(false);
  });

  it("возвраты: только REFUND, только ключ :refund; отмена — только по отменённой сделке", () => {
    expect(stillDue("cancel:x:refund", "RELEASE", facts({ dealStatus: "CANCELLED" }))).toBe(false);
    expect(stillDue("deposit:e1", "REFUND", facts({ dealStatus: "CANCELLED" }))).toBe(false);
    expect(stillDue("cancel:x:refund", "REFUND", facts({ dealStatus: "TERMINATED" }))).toBe(false);
    expect(stillDue("deposit:e1:refund", "REFUND", facts({ dealStatus: "CANCELLED" }))).toBe(true);
  });

  it("семейство: снимается только хвост :retry:<число> в конце ключа", () => {
    expect(familyOf("release:s1:retry:12")).toBe("release:s1");
    expect(familyOf("release:s1:retry:2x")).toBe("release:s1:retry:2x");
    expect(familyOf("release:s1")).toBe("release:s1");
  });
});
