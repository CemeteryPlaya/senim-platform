// Тексты зоны «notifications»: страница уведомлений, колокольчик, шаблоны in-app и SMS.
// Деньги и даты приходят уже отформатированными (formatMoney, formatDateTime).
import { brand } from "@/config/brand";

type Text = { title: string; body: string };

/** «1 день», «3 дня», «5 дней». */
export function days(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

export const notifications = {
  page: {
    title: "Уведомления",
    markAllRead: "Отметить все прочитанными",
    empty: "Уведомлений пока нет",
    emptyHint: "Здесь появятся отклики, события сделок и решения оператора",
    unread: "Новое",
    open: "Открыть",
  },
  bell: {
    label: "Уведомления",
    labelUnread: (n: number) => `Уведомления: ${n} непрочитанных`,
  },
  /** SMS: коротко, со ссылкой на событие. */
  sms: (title: string, url: string | null) => (url ? `${brand.name}: ${title}. ${url}` : `${brand.name}: ${title}`),
  errors: {
    smsNotConfigured: "SMS-шлюз не настроен",
  },
  /** Push на телефон: на экране блокировки — только заголовок события и общий текст, без сумм и имён. */
  push: {
    body: "Откройте, чтобы посмотреть подробности",
    enable: "Включить уведомления",
    enabling: "Включаем…",
    disable: "Выключить уведомления на этом устройстве",
    enabled: "Уведомления на этом устройстве включены",
    hint: "Сообщим о деньгах и шагах сделки, даже когда приложение закрыто",
    denied: "Уведомления запрещены в настройках браузера. Разрешите их для этого сайта и попробуйте снова",
    unsupported: "Этот браузер не умеет присылать уведомления",
    failed: "Не удалось включить уведомления. Попробуйте ещё раз",
    iosInstall: {
      title: "Уведомления на iPhone",
      body: "На iPhone и iPad уведомления приходят только в установленном приложении (iOS 16.4 и новее). Нажмите «Поделиться», затем «На экран „Домой“», откройте приложение с экрана «Домой» и включите уведомления там.",
    },
    errors: {
      badEndpoint: "Неизвестный адрес push-сервиса",
      badSubscription: "Некорректная подписка на уведомления",
    },
  },
  segments: { ECONOMY: "Эконом", COMFORT: "Комфорт", PREMIUM: "Премиум" },
  templates: {
    requestNew: (summary: string): Text => ({ title: "Новая заявка в вашем сегменте", body: summary }),
    requestDirect: (portfolioTitle: string): Text => ({
      title: "Заказчик хочет похожее",
      body: `Новая заявка по вашей работе «${portfolioTitle}».`,
    }),
    offerReceived: (requestTitle: string, price: string, durationDays: number): Text => ({
      title: "Новый отклик на заявку",
      body: `На заявку «${requestTitle}» пришёл отклик: ${price}, срок ${days(durationDays)}.`,
    }),
    offerChosen: (requestTitle: string): Text => ({
      title: "Отклик выбран",
      body: `Адрес передан исполнителю по заявке «${requestTitle}». Договоритесь о замере в чате.`,
    }),
    offerAccepted: (requestTitle: string): Text => ({
      title: "Ваш отклик выбран",
      body: `Заявка «${requestTitle}»: адрес заказчика открыт. Договоритесь о замере в чате.`,
    }),
    offerDeclined: (requestTitle: string): Text => ({
      title: "Заказчик выбрал другой отклик",
      body: `По заявке «${requestTitle}» выбран другой исполнитель.`,
    }),
    measurementScheduled: (requestTitle: string, when: string): Text => ({
      title: "Замер назначен",
      body: `Замер по заявке «${requestTitle}»: ${when}.`,
    }),
    measurementReminder: (requestTitle: string, when: string): Text => ({
      title: "Скоро замер",
      body: `Заявка «${requestTitle}»: замер ${when}.`,
    }),
    measurementNoDeal: (requestTitle: string, fee: string | null): Text => ({
      title: "Замер завершён без сделки",
      body: fee
        ? `По заявке «${requestTitle}» сделка не состоялась. Плата за выезд — ${fee}, оплачивается напрямую исполнителю. Заявка снова открыта для откликов.`
        : `По заявке «${requestTitle}» сделка не состоялась. Заявка снова открыта для откликов.`,
    }),
    disputeOpened: (dealTitle: string): Text => ({
      title: "Открыт спор",
      body: `Сделка «${dealTitle}»: оператор рассмотрит позиции обеих сторон.`,
    }),
    disputeResolved: (dealTitle: string): Text => ({
      title: "Спор рассмотрен",
      body: `Оператор вынес решение по сделке «${dealTitle}». Подробности — в сделке.`,
    }),
    reviewReceived: (dealTitle: string, rating: number): Text => ({
      title: "Новый отзыв",
      body: `Оценка ${rating} из 5 по сделке «${dealTitle}».`,
    }),
    registrationReceived: (): Text => ({
      title: "Заявка на регистрацию принята",
      body: "Оператор проверит данные в течение рабочего дня.",
    }),
    registrationPending: (summary: string): Text => ({ title: "Новая регистрация исполнителя", body: summary }),
    registrationApproved: (segment: string): Text => ({
      title: "Профиль подтверждён",
      body: `Вам присвоен сегмент «${segment}». Теперь вы видите заявки этого сегмента.`,
    }),
    registrationRejected: (reason: string): Text => ({
      title: "Регистрация отклонена",
      body: `${reason} Исправьте данные и подайте заявку снова.`,
    }),
  },
} as const;
