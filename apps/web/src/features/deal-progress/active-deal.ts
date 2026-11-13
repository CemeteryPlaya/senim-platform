import type { DealStatus } from "@/generated/prisma/enums";

/** Сделка ещё идёт: её показывают главные экраны. Завершённые, отменённые и с возвратом — в «Сделках». */
export const ACTIVE_DEAL: ReadonlySet<DealStatus> = new Set(["CREATED", "PAID_HOLD", "IN_PROGRESS", "READY", "ACCEPTED"]);
