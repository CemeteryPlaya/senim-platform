import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { to } from "./paths";

// Навигация оболочек v2 (спека редизайна, раздел 5): у каждой роли не больше пяти вкладок — панель вкладок на телефоне
// и разделы в шапке на компьютере. Остальные разделы — на экранах (профиль, уведомления — колокольчик в шапке).

/** Иконка вкладки — ключ; компонент lucide выбирает оболочка (nav-icons.ts). */
export type NavIcon =
  | "home"
  | "masters"
  | "about"
  | "login"
  | "requests"
  | "deals"
  | "chat"
  | "finance"
  | "profile"
  | "company"
  | "portfolio"
  | "measurements"
  | "money"
  | "kyc"
  | "consents"
  | "executors"
  | "disputes"
  | "staleRequests"
  | "income"
  | "report"
  | "audit"
  | "types"
  | "materials"
  | "settings";

export type NavItem = { href: string; label: string; icon: NavIcon };

/**
 * tabs — панель вкладок телефона; sections — разделы в шапке компьютера (у вошедших те же, что вкладки); action —
 * действие справа в шапке компьютера (кнопка `secondary`: главная кнопка принадлежит экрану); guest — не вошёл;
 * focus — сосредоточенная оболочка (у вошедшего не пройдены первые шаги): ни вкладок, ни разделов, ни действия — только
 * название продукта и «Выйти» (рисует оболочка).
 */
export type AppNav = {
  tabs: NavItem[];
  sections: NavItem[];
  action?: { href: string; label: string };
  guest: boolean;
  focus: boolean;
  /** Меню оператора (только у оператора): слева по группам на компьютере, «Меню» шторкой на телефоне. */
  operator?: OperatorNav;
};

/** Группа разделов оператора: подпись и пункты. */
export type NavGroup = { key: "queues" | "dealsReports" | "reference"; label: string; items: NavItem[] };

/**
 * Меню оператора (спека, раздел 5): 15 разделов в строку шапки не помещаются — на компьютере они слева по группам
 * («Очереди», «Сделки и отчёты», «Справочники и настройки»), на телефоне — в шторке «Меню». Сверху — главная, внизу —
 * профиль (как в v1).
 */
export type OperatorNav = { home: NavItem; groups: NavGroup[]; profile: NavItem };

/** Ровно то, что нужно навигации от текущего пользователя (подмножество CurrentUser из identity). */
export type NavUser = {
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
  /**
   * Покупатель идёт к профилю мастера (`becomingMaster`: выбрал «Я мастер», профиля ещё нет): вкладки как у неодобренного
   * мастера и без «Заказать мебель». Считает layout по cookie выбора; нет — `false`.
   */
  becomingMaster?: boolean;
  /** У идущего к профилю мастера есть сделки как у заказчика: ему остаётся вкладка «Сделки». Считает layout; нет — `false`. */
  hasBuyerDeals?: boolean;
};

/** Флаги (platform/features), от которых зависят вкладки: раздел за выключенным флагом в меню не показывается. */
export type NavFeatures = { preContractFlows: boolean; inspiration: boolean; materialsCalculator: boolean };

const t = ru.app.shell.nav;

const R = {
  home: { href: to("/"), label: t.home, icon: "home" },
  /** «Главная» неодобренного мастера: его дом — регистрация и статус проверки (`homeFor`), а не главная v2. */
  registration: { href: to("/register/executor"), label: t.home, icon: "home" },
  masters: { href: to("/catalog"), label: t.masters, icon: "masters" },
  about: { href: to("/about"), label: t.about, icon: "about" },
  login: { href: to("/login"), label: t.login, icon: "login" },
  requests: { href: to("/requests"), label: t.requests, icon: "requests" },
  deals: { href: to("/deals"), label: t.deals, icon: "deals" },
  incoming: { href: to("/executor/requests"), label: t.requests, icon: "requests" },
  chat: { href: to("/chats"), label: t.chat, icon: "chat" },
  finance: { href: to("/executor/finance"), label: t.finance, icon: "finance" },
  profile: { href: to("/profile"), label: t.profile, icon: "profile" },
  company: { href: to("/executor/profile"), label: t.company, icon: "company" },
  portfolio: { href: to("/executor/portfolio"), label: t.portfolio, icon: "portfolio" },
  measurements: { href: to("/measurer"), label: t.measurements, icon: "measurements" },
} as const satisfies Record<string, NavItem>;

const op = ru.app.operator.nav;

/** Разделы оператора v2: адреса v2 тех же разделов v1 (`/operator/...`); ещё не перенесённые открываются заглушкой. */
const OP = {
  home: { href: to("/operator"), label: op.home, icon: "home" },
  money: { href: to("/operator/money"), label: op.money, icon: "money" },
  kyc: { href: to("/operator/kyc"), label: op.kyc, icon: "kyc" },
  consents: { href: to("/operator/consents"), label: op.consents, icon: "consents" },
  executors: { href: to("/operator/executors"), label: op.executors, icon: "executors" },
  disputes: { href: to("/operator/disputes"), label: op.disputes, icon: "disputes" },
  requests: { href: to("/operator/requests"), label: op.requests, icon: "staleRequests" },
  deals: { href: to("/operator/deals"), label: op.deals, icon: "deals" },
  income: { href: to("/operator/income"), label: op.income, icon: "income" },
  report: { href: to("/operator/report"), label: op.report, icon: "report" },
  audit: { href: to("/operator/audit"), label: op.audit, icon: "audit" },
  types: { href: to("/operator/furniture-types"), label: op.types, icon: "types" },
  materials: { href: to("/operator/materials"), label: op.materials, icon: "materials" },
  settings: { href: to("/operator/settings"), label: op.settings, icon: "settings" },
  profile: { href: to("/profile"), label: op.profile, icon: "profile" },
} as const satisfies Record<string, NavItem>;

/** Вкладки за флагами: «Замеры» замерщика — сценарии до договора (Фаза 2, по умолчанию выключены). */
const FLAGGED: Readonly<Partial<Record<NavItem["href"], keyof NavFeatures>>> = {
  [R.measurements.href]: "preContractFlows",
  [OP.materials.href]: "materialsCalculator",
};

/** Пункт не за выключенным флагом. */
const shownWith =
  (f: NavFeatures) =>
  (item: NavItem): boolean => {
    const flag = FLAGGED[item.href];
    return flag === undefined || f[flag];
  };

/** Меню оператора по группам; пункты за выключенными флагами («Цены материалов») не попадают, пустая группа — тоже. */
function operatorNav(f: NavFeatures): OperatorNav {
  const g = ru.app.operator.groups;
  const groups: NavGroup[] = [
    { key: "queues", label: g.queues, items: [OP.money, OP.kyc, OP.consents, OP.executors, OP.disputes, OP.requests] },
    { key: "dealsReports", label: g.dealsReports, items: [OP.deals, OP.income, OP.report, OP.audit] },
    { key: "reference", label: g.reference, items: [OP.types, OP.materials, OP.settings] },
  ];
  return {
    home: OP.home,
    groups: groups.map((group) => ({ ...group, items: group.items.filter(shownWith(f)) })).filter((group) => group.items.length > 0),
    profile: OP.profile,
  };
}

/** Все пункты меню оператора по порядку: главная, группы, профиль. */
export function operatorItems(nav: OperatorNav): NavItem[] {
  return [nav.home, ...nav.groups.flatMap((group) => group.items), nav.profile];
}

function roleTabs(user: NavUser): NavItem[] {
  switch (user.role) {
    case "CLIENT":
      // Идущий к профилю мастера: дом — анкета мастера (`/v2` ведёт туда же). «Компании» нет: её страница требует роль мастера.
      // Идущему со сделками заказчика «Сделки» остаётся: иначе до суток (срок выбора) путь к ним пропадает.
      if (user.becomingMaster) return user.hasBuyerDeals ? [R.registration, R.deals, R.profile] : [R.registration, R.profile];
      return [R.home, R.requests, R.deals, R.chat, R.profile];
    case "EXECUTOR":
      // Мастер: «что сейчас» на главной; финансы, компания и портфолио — из профиля и главной. Неодобренный (нет профиля,
      // на проверке, отказ): «Главная» — регистрация и статус проверки (тот же дом, что у `homeFor`; `/v2` его туда
      // направляет), компания — что о нём увидят покупатели.
      return user.executor?.status === "APPROVED"
        ? [R.home, R.incoming, R.deals, R.chat, R.profile]
        : [R.registration, R.company, R.profile];
    case "MEASURER":
      return [R.measurements, R.chat, R.profile];
    case "OPERATOR":
      // Вкладок нет: разделы оператора — меню слева по группам (компьютер) и «Меню» шторкой (телефон), см. operatorNav.
      return [];
  }
}

/**
 * Меню пользователя (null — гость). Вкладки за выключенными флагами не попадают.
 * Гость: на телефоне — Главная · Мастера · О сервисе · Войти («Войти» — последняя вкладка); в шапке компьютера —
 * разделы Мастера · О сервисе (на главную ведёт название продукта), «Войти» — действие справа.
 * `options.focus` — у вошедшего есть непройденные первые шаги: сосредоточенная оболочка (см. AppNav.focus).
 */
export function navFor(user: NavUser | null, f: NavFeatures, options: { focus?: boolean } = {}): AppNav {
  // Первые шаги после входа (согласие, знакомство, почта): человеку нужно пройти их, а не переходить по разделам.
  if (user && options.focus) return { tabs: [], sections: [], guest: false, focus: true };
  if (!user) {
    return {
      tabs: [R.home, R.masters, R.about, R.login],
      sections: [R.masters, R.about],
      action: { href: R.login.href, label: R.login.label },
      guest: true,
      focus: false,
    };
  }
  if (user.role === "OPERATOR") return { tabs: [], sections: [], guest: false, focus: false, operator: operatorNav(f) };
  const tabs = roleTabs(user).filter(shownWith(f));
  const action = user.role === "CLIENT" && !user.becomingMaster ? { href: to("/requests/new"), label: ru.app.shell.order } : undefined;
  return action ? { tabs, sections: tabs, action, guest: false, focus: false } : { tabs, sections: tabs, guest: false, focus: false };
}

/**
 * Адрес активной вкладки для aria-current="page": раздел, под которым лежит адрес (по целым сегментам), самый точный
 * из подходящих. Главная v2 подсвечивается только на самой главной; `exact` — другие такие адреса (главная оператора:
 * разделы оператора лежат под ней, но она подсвечена только на себе). `null` — адреса нет (рендер вне роутера).
 */
export function activeHref(items: readonly NavItem[], pathname: string | null, exact: readonly string[] = []): string | undefined {
  if (pathname === null) return undefined;
  const home = to("/");
  let best: string | undefined;
  for (const { href } of items) {
    const match = href === home || exact.includes(href) ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    if (match && (best === undefined || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * Действие справа в шапке компьютера на этом адресе. На экранах входа (`/v2/login` и его шаги) кнопка «Войти» не
 * показывается: человек уже на входе, а на телефоне вкладка «Войти» остаётся активной. Остальные действия и страницы —
 * без изменений. `null` — адреса нет (рендер вне роутера): действие показывается.
 */
export function visibleAction(action: AppNav["action"], pathname: string | null): AppNav["action"] {
  if (!action || pathname === null || action.href !== R.login.href) return action;
  const onLogin = pathname === R.login.href || pathname.startsWith(`${R.login.href}/`);
  return onLogin ? undefined : action;
}

/**
 * Корневой ли это экран вкладки: адрес совпадает с адресом одной из вкладок (главная, заявки, сделки, чат, профиль), а не
 * лежит под ним. Вложенные экраны (`/v2/deals/7`) со своей строкой «Назад» — не корневые. `null` — адреса нет: не корневой.
 */
export function isTabRoot(items: readonly NavItem[], pathname: string | null): boolean {
  if (pathname === null) return false;
  const here = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return items.some((item) => item.href === here);
}
