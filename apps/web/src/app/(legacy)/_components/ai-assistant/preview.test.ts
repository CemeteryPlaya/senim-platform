import { describe, expect, it } from "vitest";
import type { RequestDraft } from "@/modules/ai/client";
import { pickFields, previewRows } from "./preview";

const draft: RequestDraft = {
  furnitureTypeSlug: "kitchen",
  customType: null,
  style: "scandi",
  details: { widthCm: 320, heightCm: 270, facade: "mdf_enamel", hardware: "soft_close", color: "Белый, дуб", unknown: ["countertop"] },
  wishes: "Нужна подсветка",
};
const names = { kitchen: "Кухня" };

describe("previewRows — что показать заказчику на проверку", () => {
  it("только найденные поля, по-русски и в порядке мастера", () => {
    expect(previewRows(draft, names)).toEqual([
      { key: "furnitureType", label: "Что делаем", value: "Кухня" },
      { key: "style", label: "Стиль", value: "Скандинавский" },
      { key: "size", label: "Размеры", value: "ширина 320 см, высота 270 см" },
      { key: "facade", label: "Фасады", value: "МДФ эмаль" },
      { key: "hardware", label: "Фурнитура", value: "С доводчиками" },
      { key: "color", label: "Цвет", value: "Белый, дуб" },
      { key: "unknown", label: "Подскажет исполнитель", value: "столешница" },
      { key: "wishes", label: "Пожелания", value: "Нужна подсветка" },
    ]);
  });

  it("пустой черновик — пустой список", () => {
    expect(previewRows({ furnitureTypeSlug: null, customType: null, style: null, details: {}, wishes: "" }, names)).toEqual([]);
  });
});

describe("pickFields — переносится только отмеченное", () => {
  it("снятые поля не попадают в черновик", () => {
    const picked = pickFields(draft, new Set(["furnitureType", "size", "facade"]));
    expect(picked).toEqual({
      furnitureTypeSlug: "kitchen",
      customType: null,
      style: null,
      details: { widthCm: 320, heightCm: 270, facade: "mdf_enamel" },
      wishes: "",
    });
  });

  it("всё отмечено — черновик без изменений", () => {
    const all = new Set(previewRows(draft, names).map((r) => r.key));
    expect(pickFields(draft, all)).toEqual(draft);
  });
});
