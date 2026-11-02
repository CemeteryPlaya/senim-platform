import { ai } from "./ru/ai";
import { bankDemo } from "./ru/bankDemo";
import { common } from "./ru/common";
import { companies } from "./ru/companies";
import { deal } from "./ru/deal";
import { documents } from "./ru/documents";
import { executor } from "./ru/executor";
import { files } from "./ru/files";
import { identity } from "./ru/identity";
import { landing } from "./ru/landing";
import { materials } from "./ru/materials";
import { notifications } from "./ru/notifications";
import { operator } from "./ru/operator";
import { payments } from "./ru/payments";
import { pwa } from "./ru/pwa";
import { requests } from "./ru/requests";

/**
 * Все тексты интерфейса. В разметке строк нет: только ru.<зона>.<ключ>.
 * Каждая зона — свой файл в ./ru/, чтобы параллельные правки не конфликтовали.
 */
export const ru = {
  common,
  identity,
  companies,
  requests,
  executor,
  deal,
  payments,
  documents,
  files,
  notifications,
  operator,
  materials,
  ai,
  landing,
  bankDemo,
  pwa,
} as const;
