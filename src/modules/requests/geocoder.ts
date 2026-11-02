import "server-only";
import { z } from "zod";
import type { CurrentUser } from "@/modules/identity";
import { env } from "@/platform/env";
import { requireClient } from "./access";
import type { GeoPoint } from "./schema";

/**
 * Геокодер адреса заявки (решение 2.2.5): адрес → точка. Внешнего API пока нет (ключи даёт владелец), поэтому —
 * только интерфейс и мок, выбор через env GEOCODER_PROVIDER (проверен в platform/env.ts).
 * TODO(геокодер): реальный провайдер — после выбора сервиса и ключей; API не выдумываем.
 */

/** Насколько точно найдено: до дома или только город (тогда точку лучше уточнить геолокацией). */
export type GeocodePrecision = "address" | "city";
export type GeocodeResult = GeoPoint & { precision: GeocodePrecision };

export interface Geocoder {
  geocode(query: { city: string; address: string }): Promise<GeocodeResult | null>;
}

/** Центры крупных городов Казахстана: мок узнаёт только город и честно помечает точность «город». */
const CITY_CENTERS: Readonly<Record<string, GeoPoint>> = {
  астана: { lat: 51.1282, lng: 71.4305 },
  алматы: { lat: 43.2383, lng: 76.9454 },
  шымкент: { lat: 42.3417, lng: 69.5901 },
  караганда: { lat: 49.8047, lng: 73.1094 },
  актобе: { lat: 50.2839, lng: 57.167 },
};

export const mockGeocoder: Geocoder = {
  async geocode({ city }) {
    const center = CITY_CENTERS[city.trim().toLowerCase().replace(/ё/g, "е")];
    return center ? { ...center, precision: "city" } : null;
  },
};

export function geocoder(): Geocoder {
  switch (env().GEOCODER_PROVIDER) {
    case "mock":
      return mockGeocoder;
  }
}

export const geocodeSchema = z.strictObject({ city: z.string().trim().min(2).max(60), address: z.string().trim().max(200) });

/** «Найти по адресу» в мастере заявки: только заказчик; адрес наружу уходит без имени и телефона. */
export async function geocodeAddress(user: CurrentUser, input: z.output<typeof geocodeSchema>): Promise<GeocodeResult | null> {
  requireClient(user);
  return geocoder().geocode(input);
}
