import { describe, expect, it } from "vitest";
import { currentStageIndex, heroImage, paidAmount, stageDate, stageState } from "./order-view";

const d = (iso: string) => new Date(iso);

describe("текущий этап заказа", () => {
  const stages = [{ status: "CLOSED" as const }, { status: "IN_PROGRESS" as const }, { status: "PENDING" as const }];

  it("в работе и в споре — первый незакрытый этап", () => {
    expect(currentStageIndex("IN_PROGRESS", stages)).toBe(1);
    expect(currentStageIndex("DISPUTE", stages)).toBe(1);
  });

  it("до подписи, после завершения и при отмене текущего этапа нет", () => {
    for (const status of ["AWAITING_SIGNATURES", "AWAITING_DEPOSIT", "COMPLETED", "CANCELLED", "TERMINATED"] as const) {
      expect(currentStageIndex(status, stages)).toBeNull();
    }
    expect(currentStageIndex("IN_PROGRESS", [{ status: "CLOSED" }])).toBeNull();
  });

  it("кружок: принятые и закрытые пройдены, текущий выделен, остальные впереди", () => {
    expect(stageState({ status: "ACCEPTED" }, 0, 1)).toBe("done");
    expect(stageState({ status: "CLOSED" }, 0, null)).toBe("done");
    expect(stageState({ status: "SUBMITTED" }, 1, 1)).toBe("current");
    expect(stageState({ status: "PENDING" }, 2, 1)).toBe("todo");
  });
});

describe("дата этапа — самая свежая отметка", () => {
  const none = { startedAt: null, submittedAt: null, acceptedAt: null, closedAt: null };
  it("закрыт важнее принят, принят важнее сдан, сдан важнее начат", () => {
    const all = { startedAt: d("2026-04-01"), submittedAt: d("2026-04-02"), acceptedAt: d("2026-04-03"), closedAt: d("2026-04-04") };
    expect(stageDate(all)).toEqual({ kind: "closed", at: all.closedAt });
    expect(stageDate({ ...all, closedAt: null })).toEqual({ kind: "accepted", at: all.acceptedAt });
    expect(stageDate({ ...all, closedAt: null, acceptedAt: null })).toEqual({ kind: "submitted", at: all.submittedAt });
    expect(stageDate({ ...none, startedAt: all.startedAt })).toEqual({ kind: "started", at: all.startedAt });
  });
  it("этап не начат — даты нет", () => {
    expect(stageDate(none)).toBeNull();
  });
});

describe("главное фото заказа", () => {
  const room = [{ src: "/room.jpg" }];
  it("свежий фотоотчёт важнее фото помещения", () => {
    expect(heroImage([{ photos: [{ src: "/s1.jpg" }] }, { photos: [{ src: "/s2.jpg" }, { src: "/s2b.jpg" }] }, { photos: [] }], room, "/img/kitchen.svg")).toBe("/s2.jpg");
  });
  it("без фотоотчётов — фото помещения, затем иллюстрация, затем ничего", () => {
    expect(heroImage([{ photos: [] }], room, "/img/kitchen.svg")).toBe("/room.jpg");
    expect(heroImage([], [], "/img/kitchen.svg")).toBe("/img/kitchen.svg");
    expect(heroImage([], [], null)).toBeNull();
  });
});

describe("оплачено исполнителю", () => {
  it("считает только подтверждённые исполнителем оплаты", () => {
    const stages = [
      { payment: { status: "CONFIRMED", amount: 500 } },
      { payment: { status: "MARKED_PAID", amount: 300 } },
      { payment: null },
      { payment: { status: "CONFIRMED", amount: 200 } },
    ];
    expect(paidAmount(stages)).toBe(700);
  });
});
