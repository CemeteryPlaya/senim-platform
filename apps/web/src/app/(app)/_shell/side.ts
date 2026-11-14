import type { Role } from "@/generated/prisma/enums";

/**
 * Сторона сделки: покупатель (роль `CLIENT`) или мастер (`EXECUTOR`). Экраны, общие для сторон (сделка, подпись, спор,
 * история денег, чаты, список сделок), получают сторону параметром — ворота (`partyDeal`, `requireParty`) и view-модели.
 */
export type DealSide = Extract<Role, "CLIENT" | "EXECUTOR">;

/** Роль — сторона сделки (покупатель или мастер), а не оператор и не замерщик. */
export const isDealSide = (role: Role): role is DealSide => role === "CLIENT" || role === "EXECUTOR";
