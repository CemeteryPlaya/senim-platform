/** Только внутренние пути: «/deals/…». Внешние и «//host» — на страницу уведомлений (без открытого редиректа). */
export function safeLink(link: string | null): string {
  return link && link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\") ? link : "/notifications";
}
