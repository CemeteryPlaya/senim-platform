// Вкладка «Чат»: список диалогов по откликам.
export const chats = {
  metaTitle: "Чат",
  title: "Чат",
  listLabel: "Диалоги",
  noMessages: "Пока без сообщений",
  closed: "Чат закрыт",
  openChat: (counterpart: string, title: string) => `Открыть чат: ${counterpart}, ${title}`,
  empty: {
    title: "Диалогов пока нет",
    client: { description: "Чат с мастером появится, когда придёт первый отклик на вашу заявку.", action: "Создать заявку" },
    executor: { description: "Чат с заказчиком откроется, когда вы откликнетесь на заявку.", action: "Заявки" },
    other: { description: "Переписка по откликам ведётся в ролях заказчика и мастера." },
  },
} as const;
