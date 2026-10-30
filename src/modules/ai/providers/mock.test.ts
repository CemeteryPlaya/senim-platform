import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DEFAULT_FURNITURE_TYPES } from "@/verticals/furniture";
import { parseDraftSuggestion, type RequestDraftSuggestion } from "../schema";
import { mockProvider } from "./mock";

const furnitureTypes = DEFAULT_FURNITURE_TYPES;

async function structure(text: string): Promise<RequestDraftSuggestion> {
  const { raw } = await mockProvider.structureRequest({ text, furnitureTypes });
  const parsed = parseDraftSuggestion(raw);
  if (!parsed.ok) throw new Error(`мок вернул ответ не по схеме: ${parsed.issues.join("; ")}`);
  return parsed.suggestion;
}

describe("mockProvider.structureRequest — детерминированный разбор по ключевым словам", () => {
  it("кухня с размерами, материалами, стилем и цветом", async () => {
    const s = await structure(
      "Нужна кухня в современном стиле, 3,2 метра в длину, высота 2,7 м, глубина 60 см. " +
        "Фасады МДФ эмаль, столешница искусственный камень, фурнитура Blum. Цвет белый с дубом.",
    );
    expect(s).toMatchObject({
      furnitureTypeSlug: "kitchen",
      style: "modern",
      widthCm: 320,
      heightCm: 270,
      depthCm: 60,
      facade: "mdf_enamel",
      countertop: "artificial_stone",
      hardware: "premium",
      color: "Белый, дуб",
      unknown: [],
    });
  });

  it("размеры через «x» в миллиметрах и ЛДСП с обычной фурнитурой", async () => {
    const s = await structure("шкаф-купе 2400х2600х600 мм, ЛДСП, обычная фурнитура");
    expect(s).toMatchObject({
      furnitureTypeSlug: "wardrobe",
      widthCm: 240,
      heightCm: 260,
      depthCm: 60,
      facade: "ldsp",
      countertop: null,
      hardware: "standard",
    });
  });

  it("«не знаю» про размеры и материалы", async () => {
    const s = await structure("Хочу прихожую, размеры не знаю, материалы подскажите");
    expect(s.furnitureTypeSlug).toBe("hallway");
    expect(s.widthCm).toBeNull();
    expect(s.unknown).toEqual(["size", "facade", "hardware"]);
  });

  it("стол — не столешница; массив — фасад; одно число без подписи — ширина", async () => {
    const s = await structure("Обеденный стол из массива, 1,8 м, с доводчиками не нужно");
    expect(s).toMatchObject({ furnitureTypeSlug: "table", facade: "solid_wood", widthCm: 180, countertop: null });
  });

  it("неоклассика не путается с классикой", async () => {
    expect((await structure("гостиная, неоклассика")).style).toBe("neoclassic");
    expect((await structure("спальня в классическом стиле")).style).toBe("classic");
  });

  it("плёнка, кварц и доводчики", async () => {
    const s = await structure("кухня, фасады мдф в плёнке, столешница из кварца, петли с доводчиками");
    expect(s).toMatchObject({ facade: "mdf_film", countertop: "quartz", hardware: "soft_close" });
  });

  it("тип мебели, которого нет в справочнике оператора, не подставляется", async () => {
    const { raw } = await mockProvider.structureRequest({
      text: "нужна кухня",
      furnitureTypes: [{ slug: "wardrobe", name: "Шкаф-купе" }],
    });
    expect(raw).toMatchObject({ furnitureTypeSlug: null });
  });

  it("текст без распознаваемого — пустые поля и текст в пожеланиях", async () => {
    const s = await structure("Что-нибудь красивое");
    expect(s).toMatchObject({ furnitureTypeSlug: null, style: null, widthCm: null, facade: null, wishes: "Что-нибудь красивое" });
  });

  it("одинаковый текст — одинаковый ответ и учёт без денег", async () => {
    const text = "кухня 3 м, лофт";
    const a = await mockProvider.structureRequest({ text, furnitureTypes });
    const b = await mockProvider.structureRequest({ text, furnitureTypes });
    expect(a).toEqual(b);
    expect(a.usage.model).toBe("mock/text");
    expect(a.usage.inputTokens).toBeGreaterThan(0);
  });
});

describe("mockProvider.visualizeRoom — иллюстрация без сети", () => {
  it("возвращает PNG того же соотношения сторон, детерминированно", async () => {
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#d8d2c8" } }).jpeg().toBuffer();
    const input = { image: new Uint8Array(photo), contentType: "image/jpeg", prompt: "кухня шалфей" };
    const a = await mockProvider.visualizeRoom(input);
    const b = await mockProvider.visualizeRoom(input);

    expect(a.images).toHaveLength(1);
    expect(a.images[0].contentType).toBe("image/png");
    expect(Buffer.from(a.images[0].data).equals(Buffer.from(b.images[0].data))).toBe(true);
    const meta = await sharp(a.images[0].data).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width! / meta.height!).toBeCloseTo(1200 / 900, 1);
    expect(a.usage).toEqual({ model: "mock/image", images: 1 });
  });
});
