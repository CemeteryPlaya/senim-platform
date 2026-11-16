/** Календарная дата по Астане (`YYYY-MM-DD`, часовой пояс `Asia/Almaty`): даты документов банка и «сегодня» экранов. */
export function astanaDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(now);
}
