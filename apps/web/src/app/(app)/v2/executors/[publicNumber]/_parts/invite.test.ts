import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { inviteView, type OwnInvitable } from "./invite";

const t = ru.app.guest.executor.invite;

const own = (over: Partial<OwnInvitable> & { id: string; number: number }): OwnInvitable => ({ title: "Кухня", segment: "COMFORT", invitation: null, ...over });
const master = { publicNumber: 9, segment: "COMFORT" as const };

describe("inviteView: что показать покупателю на странице мастера", () => {
  it("не покупатель (гость, мастер) — ничего", () => {
    expect(inviteView({ executor: master, buyer: false, context: own({ id: "a", number: 1 }), own: [] })).toEqual({ kind: "none" });
  });

  it("заказ из адреса, та же группа — кнопка «Пригласить к заказу №N»", () => {
    const context = own({ id: "a", number: 7 });
    expect(inviteView({ executor: master, buyer: true, context, own: [context] })).toEqual({ kind: "context", label: t.action(7), requestId: "a" });
  });

  it("заказ из адреса: приглашение есть — состояние без кнопки; отказ мастера — своя строка", () => {
    for (const invitation of ["INVITED", "OFFERED"] as const) {
      const context = own({ id: "a", number: 7, invitation });
      expect(inviteView({ executor: master, buyer: true, context, own: [context] })).toEqual({ kind: "note", text: t.sent(7) });
    }
    const declined = own({ id: "a", number: 7, invitation: "DECLINED" });
    expect(inviteView({ executor: master, buyer: true, context: declined, own: [declined] })).toEqual({ kind: "note", text: t.declined(7) });
  });

  it("другая группа (в том числе у мастера группы нет) — строка без кнопки", () => {
    const context = own({ id: "a", number: 7, segment: "PREMIUM" });
    expect(inviteView({ executor: master, buyer: true, context, own: [context] })).toEqual({ kind: "note", text: t.otherSegment });
    const c2 = own({ id: "a", number: 7 });
    expect(inviteView({ executor: { publicNumber: 9, segment: null }, buyer: true, context: c2, own: [c2] })).toEqual({ kind: "note", text: t.otherSegment });
  });

  it("без заказа в адресе: нет подходящих заказов — ничего; только чужой группы — строка; свободные — выбор в шторке", () => {
    expect(inviteView({ executor: master, buyer: true, context: null, own: [] })).toEqual({ kind: "none" });
    expect(inviteView({ executor: master, buyer: true, context: null, own: [own({ id: "p", number: 2, segment: "ECONOMY" })] })).toEqual({ kind: "note", text: t.otherSegment });
    const view = inviteView({
      executor: master,
      buyer: true,
      context: null,
      own: [own({ id: "a", number: 7 }), own({ id: "b", number: 8, title: "Шкаф" }), own({ id: "c", number: 9, invitation: "INVITED" }), own({ id: "p", number: 2, segment: "ECONOMY" })],
    });
    expect(view).toEqual({
      kind: "pick",
      label: t.pick,
      options: [
        { requestId: "a", label: t.sheet.option(7, "Кухня") },
        { requestId: "b", label: t.sheet.option(8, "Шкаф") },
      ],
    });
  });

  it("без заказа в адресе: все подходящие уже приглашены — «Приглашение отправлено»", () => {
    expect(inviteView({ executor: master, buyer: true, context: null, own: [own({ id: "c", number: 9, invitation: "OFFERED" })] })).toEqual({ kind: "note", text: t.sent(9) });
  });
});
