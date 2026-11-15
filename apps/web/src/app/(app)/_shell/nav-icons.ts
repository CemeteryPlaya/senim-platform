import {
  ClipboardList,
  FileCheck2,
  Hammer,
  House,
  Images,
  Info,
  LogIn,
  type LucideIcon,
  MessageCircle,
  Ruler,
  Store,
  UserRound,
  Wallet,
} from "lucide-react";
import type { NavIcon } from "./nav";

/** Иконки вкладок: lucide, линейные, цвет текста (docs/design/v3/rules.md, «Форма и глубина»). */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  masters: Hammer,
  about: Info,
  login: LogIn,
  requests: ClipboardList,
  // «Сделки» — документ с отметкой (оферта заключена), а не рукопожатие: на 24 px рукопожатие не читается (разбор 3.6).
  deals: FileCheck2,
  chat: MessageCircle,
  finance: Wallet,
  profile: UserRound,
  company: Store,
  portfolio: Images,
  measurements: Ruler,
};
