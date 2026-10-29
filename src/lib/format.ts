const TZ = "Asia/Almaty";

export function tenge(amount: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₸";
}

export function date(d: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date(d));
}

export function shortDate(d: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: TZ }).format(new Date(d));
}

export function dateTime(d: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(d));
}

export function time(d: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d));
}

export function dealNo(n: number) {
  return `SD-${String(n).padStart(4, "0")}`;
}

export function initials(name: string) {
  const clean = name.replace(/[«»"]/g, "").replace(/^(ТОО|ИП)\s+/, "");
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Имя стороны сделки: для исполнителя — название из профиля (ТОО, ИП). */
export function partyName(u: { name: string; master?: { displayName: string } | null }) {
  return u.master?.displayName ?? u.name;
}
