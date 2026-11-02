import { describe, expect, it } from "vitest";
import { executorDisplay, parseExecutorIdentityMode, type ExecutorIdentitySource } from "./display";

const source: ExecutorIdentitySource = {
  publicNumber: 17,
  legalName: "ТОО «Мебель Сити»",
  city: "Астана",
  district: "Есильский район",
  streetAddress: "ул. Сыганак, 10",
};

describe("executorDisplay", () => {
  it("HIDDEN: «Исполнитель №N» в нужных падежах, адрес — только город и район", () => {
    expect(executorDisplay(source, "HIDDEN")).toEqual({
      label: "Исполнитель №17",
      labelGen: "Исполнителя №17",
      labelDat: "Исполнителю №17",
      address: "Астана, Есильский район",
      nameShown: false,
    });
  });

  it("HIDDEN: ни наименования, ни улицы в выводе", () => {
    const json = JSON.stringify(executorDisplay(source, "HIDDEN"));
    expect(json).not.toContain("Мебель Сити");
    expect(json).not.toContain("Сыганак");
  });

  it("SHOWN: наименование во всех падежах и полный адрес", () => {
    expect(executorDisplay(source, "SHOWN")).toEqual({
      label: "ТОО «Мебель Сити»",
      labelGen: "ТОО «Мебель Сити»",
      labelDat: "ТОО «Мебель Сити»",
      address: "Астана, Есильский район, ул. Сыганак, 10",
      nameShown: true,
    });
  });

  it("пустые части адреса пропускаются", () => {
    const noDistrict = { ...source, district: " ", streetAddress: "" };
    expect(executorDisplay(noDistrict, "HIDDEN").address).toBe("Астана");
    expect(executorDisplay(noDistrict, "SHOWN").address).toBe("Астана");
    expect(executorDisplay({ ...noDistrict, city: "" }, "SHOWN").address).toBe("");
  });
});

describe("parseExecutorIdentityMode", () => {
  it("понимает только HIDDEN и SHOWN; всё прочее — HIDDEN", () => {
    expect(parseExecutorIdentityMode("SHOWN")).toBe("SHOWN");
    expect(parseExecutorIdentityMode("HIDDEN")).toBe("HIDDEN");
    for (const raw of [undefined, null, "shown", 1, { mode: "SHOWN" }]) expect(parseExecutorIdentityMode(raw)).toBe("HIDDEN");
  });
});
