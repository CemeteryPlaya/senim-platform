import { clsx, type ClassValue } from "clsx";

/** Склейка классов Tailwind с условиями. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
