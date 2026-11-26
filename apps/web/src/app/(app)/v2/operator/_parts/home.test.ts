import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { filterChips } from "./filters";
import { operatorHome } from "./home";

const t = ru.app.operator.home;

describe("operatorHome: что требует внимания", () => {
  it("непустые очереди — по срочности, деньги первыми; адреса разделов v2", () => {
    const view = operatorHome({ money: 2, registrations: 1, openDisputes: 3, kyc: 5, stale: 11 });
    expect(view.todo).toEqual([
      { href: "/v2/operator/money", text: "2 операции ждут документа банка" },
      { href: "/v2/operator/executors", text: "1 регистрация ждёт проверки" },
      { href: "/v2/operator/disputes", text: "3 открытых спора" },
      { href: "/v2/operator/kyc", text: "5 мастеров ждут проверки документов" },
      { href: "/v2/operator/requests", text: "11 заявок без откликов дольше суток" },
    ]);
  });

  it("пустые очереди не попадают в «что требует внимания»: ни нулей, ни отдельной сводки", () => {
    const view = operatorHome({ money: 0, registrations: 0, openDisputes: 1, kyc: 0, stale: 0 });
    expect(view.todo.map((item) => item.href)).toEqual(["/v2/operator/disputes"]);
    expect(view).not.toHaveProperty("tiles");
    expect(operatorHome({ money: 0, registrations: 0, openDisputes: 0, kyc: 0, stale: 0 }).todo).toEqual([]);
  });

  it("identity не ответил (kyc null) — строка «Документы мастеров: нет связи» на месте документов, остальное как было", () => {
    const view = operatorHome({ money: 1, registrations: 0, openDisputes: 0, kyc: null, stale: 2 });
    expect(view.todo).toEqual([
      { href: "/v2/operator/money", text: "1 операция ждёт документа банка" },
      { href: "/v2/operator/kyc", text: t.kycUnavailable },
      { href: "/v2/operator/requests", text: "2 заявки без откликов дольше суток" },
    ]);
    expect(t.kycUnavailable).toBe("Документы мастеров: нет связи");
  });
});

describe("filterChips: фильтр экрана оператора в адресе", () => {
  const OPTIONS = [
    { value: null, label: "Все" },
    { value: "PENDING", label: "На проверке" },
    { value: "APPROVED", label: "Подтверждённые" },
  ];

  it("без параметра выбран «Все»; ссылки — тот же экран с параметром", () => {
    expect(filterChips("/operator/executors", {}, "status", OPTIONS)).toEqual([
      { href: "/v2/operator/executors", label: "Все", active: true },
      { href: "/v2/operator/executors?status=PENDING", label: "На проверке", active: false },
      { href: "/v2/operator/executors?status=APPROVED", label: "Подтверждённые", active: false },
    ]);
  });

  it("выбранный — по значению; прочие параметры сохраняются, курсор и страница сбрасываются", () => {
    const chips = filterChips("/operator/executors", { status: "PENDING", q: "Арман", before: "120", page: "3" }, "status", OPTIONS);
    expect(chips.map((chip) => chip.active)).toEqual([false, true, false]);
    expect(chips[0]?.href).toBe("/v2/operator/executors?q=%D0%90%D1%80%D0%BC%D0%B0%D0%BD");
    expect(chips[2]?.href).toBe("/v2/operator/executors?q=%D0%90%D1%80%D0%BC%D0%B0%D0%BD&status=APPROVED");
  });

  it("неизвестное или повторённое значение — выбран «Все»", () => {
    expect(filterChips("/operator/executors", { status: "HACK" }, "status", OPTIONS).map((chip) => chip.active)).toEqual([true, false, false]);
    expect(filterChips("/operator/executors", { status: ["PENDING", "APPROVED"] }, "status", OPTIONS)[0]?.active).toBe(true);
  });
});
