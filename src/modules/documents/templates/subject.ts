import { z } from "zod";
import { COUNTERTOPS, FACADES, HARDWARE, STYLES } from "@/verticals/furniture";

/**
 * Параметры заказа из заявки для п. 1.2 договора. `Request.details` — JSON, поэтому разбираем
 * мягко: неизвестные или пустые поля просто не попадают в договор (их уточняют на замере).
 */
const num = z.number().optional().catch(undefined);
const str = z.string().optional().catch(undefined);
const detailsSchema = z
  .object({ widthCm: num, heightCm: num, depthCm: num, facade: str, countertop: str, hardware: str, color: str })
  .catch({});

const label = (catalog: Record<string, { name: string }>, key: string | undefined) => (key ? (catalog[key]?.name ?? key) : undefined);

export function subjectDetails(request: {
  furnitureType: string | null;
  style: string | null;
  details: unknown;
  wishes: string;
}): string[] {
  const d = detailsSchema.parse(request.details ?? {});
  const size = [d.widthCm && `ширина ${d.widthCm} см`, d.heightCm && `высота ${d.heightCm} см`, d.depthCm && `глубина ${d.depthCm} см`].filter(Boolean);
  const lines: (string | null | undefined | false)[] = [
    request.furnitureType && `Тип мебели: ${request.furnitureType}`,
    request.style && `Стиль: ${label(STYLES, request.style)}`,
    size.length > 0 && `Размеры: ${size.join(", ")}`,
    d.facade && `Фасады: ${label(FACADES, d.facade)}`,
    d.countertop && `Столешница: ${label(COUNTERTOPS, d.countertop)}`,
    d.hardware && `Фурнитура: ${label(HARDWARE, d.hardware)}`,
    d.color && `Цвет: ${d.color}`,
    request.wishes.trim() && `Пожелания: ${request.wishes.trim()}`,
  ];
  return lines.filter((l): l is string => typeof l === "string" && l.length > 0);
}
