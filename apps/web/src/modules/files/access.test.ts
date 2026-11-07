import { describe, expect, it } from "vitest";
import { decideFileAccess, type FileFacts, type RequestFacts, type Viewer } from "./access";

const client: Viewer = { id: "c1", role: "CLIENT", executor: null };
const otherClient: Viewer = { id: "c2", role: "CLIENT", executor: null };
const operator: Viewer = { id: "o1", role: "OPERATOR", executor: null };
const executor = (over: Partial<NonNullable<NonNullable<Viewer>["executor"]>> = {}, id = "e1"): Viewer => ({
  id,
  role: "EXECUTOR",
  executor: { id: `p-${id}`, status: "APPROVED", segment: "COMFORT", ...over },
});

const tender: RequestFacts = { clientId: "c1", mode: "TENDER", status: "OPEN", segment: "COMFORT", targetExecutorId: null, viewerHasOffer: false };
const req = (r: Partial<RequestFacts> = {}): FileFacts => ({ uploadedById: "c1", owner: { kind: "request", request: { ...tender, ...r } } });

describe("права на файл", () => {
  it("портфолио публично, даже для гостя; неопубликованное — владельцу и оператору", () => {
    const pub: FileFacts = { uploadedById: "e1", owner: { kind: "portfolio", published: true, ownerUserId: "e1" } };
    const hidden: FileFacts = { uploadedById: "e1", owner: { kind: "portfolio", published: false, ownerUserId: "e1" } };
    expect(decideFileAccess(null, pub)).toBe(true);
    expect(decideFileAccess(otherClient, pub)).toBe(true);
    expect(decideFileAccess(null, hidden)).toBe(false);
    expect(decideFileAccess(otherClient, hidden)).toBe(false);
    expect(decideFileAccess(executor(), hidden)).toBe(true);
    expect(decideFileAccess(operator, hidden)).toBe(true);
  });

  it("фото помещения: заказчик заявки и оператор; чужой заказчик и гость — нет", () => {
    expect(decideFileAccess(client, req())).toBe(true);
    expect(decideFileAccess(operator, req())).toBe(true);
    expect(decideFileAccess(otherClient, req())).toBe(false);
    expect(decideFileAccess(null, req())).toBe(false);
  });

  it("тендер видят подтверждённые исполнители того же сегмента, пока заявка открыта", () => {
    expect(decideFileAccess(executor(), req())).toBe(true);
    expect(decideFileAccess(executor({ segment: "PREMIUM" }), req())).toBe(false);
    expect(decideFileAccess(executor({ status: "PENDING" }), req())).toBe(false);
    expect(decideFileAccess(executor(), req({ status: "DRAFT" }))).toBe(false);
    expect(decideFileAccess(executor(), req({ status: "MEASURING" }))).toBe(false);
    expect(decideFileAccess(executor(), req({ segment: null }))).toBe(false);
  });

  it("исполнитель с откликом видит фото и после закрытия приёма откликов", () => {
    expect(decideFileAccess(executor({ segment: "PREMIUM" }), req({ status: "MEASURING", viewerHasOffer: true }))).toBe(true);
  });

  it("прямую заявку видит только выбранный исполнитель, и не в черновике", () => {
    const direct = { mode: "DIRECT" as const, targetExecutorId: "p-e1" };
    expect(decideFileAccess(executor(), req(direct))).toBe(true);
    expect(decideFileAccess(executor({}, "e2"), req(direct))).toBe(false);
    expect(decideFileAccess(executor(), req({ ...direct, status: "DRAFT" }))).toBe(false);
  });

  it("этап, спор, документ, вложение чата — только стороны и оператор", () => {
    const facts: FileFacts = { uploadedById: "e1", owner: { kind: "parties", userIds: ["c1", "e1"] } };
    expect(decideFileAccess(client, facts)).toBe(true);
    expect(decideFileAccess(executor(), facts)).toBe(true);
    expect(decideFileAccess(operator, facts)).toBe(true);
    expect(decideFileAccess(otherClient, facts)).toBe(false);
    expect(decideFileAccess(executor({}, "e9"), facts)).toBe(false);
  });

  it("неприкреплённый файл видит только загрузивший и оператор", () => {
    const facts: FileFacts = { uploadedById: "c1", owner: { kind: "none" } };
    expect(decideFileAccess(client, facts)).toBe(true);
    expect(decideFileAccess(operator, facts)).toBe(true);
    expect(decideFileAccess(otherClient, facts)).toBe(false);
  });
});
