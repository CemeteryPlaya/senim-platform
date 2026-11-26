import { describe, expect, it } from "vitest";
import { executorDisplay, parseExecutorIdentityMode, type ExecutorIdentitySource } from "./display";

const source: ExecutorIdentitySource = {
  publicNumber: 17,
  legalName: "ТОО «Мебель Сити»",
  city: "Астана",
};

describe("executorDisplay", () => {
  it("HIDDEN: «Исполнитель №N» в нужных падежах, из места — только город", () => {
    expect(executorDisplay(source, "HIDDEN")).toEqual({
      label: "Исполнитель №17",
      labelGen: "Исполнителя №17",
      labelDat: "Исполнителю №17",
      address: "Астана",
      nameShown: false,
    });
  });

  it("HIDDEN: наименования в выводе нет", () => {
    expect(JSON.stringify(executorDisplay(source, "HIDDEN"))).not.toContain("Мебель Сити");
  });

  it("SHOWN: наименование во всех падежах, из места — тоже только город (ADR-016)", () => {
    expect(executorDisplay(source, "SHOWN")).toEqual({
      label: "ТОО «Мебель Сити»",
      labelGen: "ТОО «Мебель Сити»",
      labelDat: "ТОО «Мебель Сити»",
      address: "Астана",
      nameShown: true,
    });
  });

  it("район и улица из старых данных не показываются ни в одном режиме; пустой город — пустая строка", () => {
    const legacy = { ...source, city: " Астана ", district: "Есильский район", streetAddress: "ул. Сыганак, 10" };
    for (const mode of ["HIDDEN", "SHOWN"] as const) {
      const json = JSON.stringify(executorDisplay(legacy, mode));
      expect(json).not.toContain("Есиль");
      expect(json).not.toContain("Сыганак");
      expect(executorDisplay(legacy, mode).address).toBe("Астана");
    }
    expect(executorDisplay({ ...source, city: "" }, "SHOWN").address).toBe("");
  });
});

describe("parseExecutorIdentityMode", () => {
  it("понимает только HIDDEN и SHOWN; всё прочее — HIDDEN", () => {
    expect(parseExecutorIdentityMode("SHOWN")).toBe("SHOWN");
    expect(parseExecutorIdentityMode("HIDDEN")).toBe("HIDDEN");
    for (const raw of [undefined, null, "shown", 1, { mode: "SHOWN" }]) expect(parseExecutorIdentityMode(raw)).toBe("HIDDEN");
  });
});
