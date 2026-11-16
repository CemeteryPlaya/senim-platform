import { describe, expect, it } from "vitest";
import { ContactActions, CopyButton, MapLink } from "./index";
import { googleMapsHref, telHref, whatsappHref, yandexMapsHref } from "./external-links";
import { html } from "./test-utils";

describe("ссылки на звонок и WhatsApp", () => {
  it("tel: — E.164 с плюсом", () => {
    expect(telHref("+77001234567")).toBe("tel:+77001234567");
    expect(telHref("+7 (700) 123-45-67")).toBe("tel:+77001234567");
  });
  it("wa.me — только цифры, без плюса", () => {
    expect(whatsappHref("+77001234567")).toBe("https://wa.me/77001234567");
    expect(whatsappHref("+7 (700) 123-45-67")).toBe("https://wa.me/77001234567");
    expect(whatsappHref("нет")).toBeNull();
  });
});

describe("ссылки на карты", () => {
  const point = { lat: 43.238949, lng: 76.889709 };
  it("Яндекс: долгота, затем широта", () => {
    expect(yandexMapsHref(point)).toBe("https://yandex.ru/maps/?pt=76.889709,43.238949&z=17&l=map");
  });
  it("Google: широта, затем долгота, запятая кодируется", () => {
    expect(googleMapsHref(point)).toBe("https://www.google.com/maps/search/?api=1&query=43.238949%2C76.889709");
  });
  it("без точки — Google ищет по адресу, Яндекс не строится", () => {
    expect(googleMapsHref(null, "Алматы, Абая 10")).toBe("https://www.google.com/maps/search/?api=1&query=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B%2C%20%D0%90%D0%B1%D0%B0%D1%8F%2010");
    expect(yandexMapsHref(null)).toBeNull();
    expect(googleMapsHref(null, "  ")).toBeNull();
  });
  it("точка вне диапазона отбрасывается", () => {
    expect(yandexMapsHref({ lat: 120, lng: 10 })).toBeNull();
    expect(googleMapsHref({ lat: Number.NaN, lng: 10 })).toBeNull();
  });
});

describe("компоненты", () => {
  it("MapLink: две ссылки в новой вкладке, координат на экране нет", () => {
    const m = html(<MapLink point={{ lat: 43.1, lng: 76.9 }} />);
    expect(m).toContain('target="_blank"');
    expect(m).toContain('rel="noopener noreferrer"');
    expect(m).toContain("Яндекс Карты");
    expect(m).toContain("Google Карты");
    expect(m.replace(/href="[^"]*"/g, "")).not.toContain("43.1");
  });
  it("MapLink без точки и адреса — пусто", () => {
    expect(html(<MapLink />)).toBe("");
  });
  it("ContactActions: позвонить, WhatsApp, копирование", () => {
    const m = html(<ContactActions phone="+77001234567" phoneDisplay="+7 700 123 45 67" />);
    expect(m).toContain('href="tel:+77001234567"');
    expect(m).toContain('href="https://wa.me/77001234567"');
    expect(m).toContain('aria-label="Скопировать номер телефона"');
  });
  it("CopyButton: имя для диктора, кнопка 48 px", () => {
    const m = html(<CopyButton value="Д-0006/2026" label="Скопировать номер сделки" />);
    expect(m).toContain('aria-label="Скопировать номер сделки"');
    expect(m).toContain("size-control");
  });
});
