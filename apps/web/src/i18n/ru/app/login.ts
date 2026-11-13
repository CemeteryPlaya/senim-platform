// Вход в новом интерфейсе (v2): номер телефона, код из SMS, подтверждение почты.
export const login = {
  /** Подтверждение почты кодом из письма (identity: RequestEmailCode, VerifyEmailCode). */
  email: {
    /** Отказы по кодам контракта identity (remote-errors.ts) и проверки формата до вызова (email.ts). */
    errors: {
      invalid: "Проверьте адрес: например, name@mail.kz",
      codeFormat: "Введите 6 цифр из письма",
      tooOften: "Код уже отправлен. Новый можно запросить через минуту",
      tooMany: "Слишком много попыток. Попробуйте через час",
      expired: "Код устарел или не запрашивался. Запросите новый",
      wrongCode: (left: number) => `Неверный код. Осталось попыток: ${left}`,
      attemptsExhausted: "Попытки закончились. Запросите новый код",
      alreadyVerified: "Эта почта уже подтверждена",
    },
  },
} as const;
