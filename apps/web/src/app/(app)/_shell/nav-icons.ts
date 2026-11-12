import {
  ClipboardList,
  Hammer,
  Handshake,
  House,
  Images,
  Info,
  LogIn,
  type LucideIcon,
  MessageCircle,
  Package,
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
  deals: Handshake,
  orders: Package,
  chat: MessageCircle,
  finance: Wallet,
  profile: UserRound,
  company: Store,
  portfolio: Images,
  measurements: Ruler,
};
