import "server-only";
import { jobHandlers as ai } from "@/modules/ai";
import { jobHandlers as companies } from "@/modules/companies";
import { jobHandlers as dealCore } from "@/modules/deal-core";
import { jobHandlers as documents } from "@/modules/documents";
import { jobHandlers as files } from "@/modules/files";
import { jobHandlers as identity } from "@/modules/identity";
import { jobHandlers as notifications } from "@/modules/notifications";
import { jobHandlers as operator } from "@/modules/operator";
import { jobHandlers as payments } from "@/modules/payments";
import { jobHandlers as requests } from "@/modules/requests";
import type { JobHandlers } from "@/platform/jobs";

/**
 * Все обработчики фоновых задач. Каждый модуль экспортирует свои `jobHandlers`
 * с ключами вида «<модуль>.<задача>», поэтому они не пересекаются.
 */
export const jobHandlers: JobHandlers = {
  ...ai,
  ...companies,
  ...dealCore,
  ...documents,
  ...files,
  ...identity,
  ...notifications,
  ...operator,
  ...payments,
  ...requests,
};
