// Тексты зоны «requests»: мастер заявки, мои заявки, отклики, замеры. Владелец — marketplace-engineer.
export const requests = {
  validation: {
    size: "Укажите размер в сантиметрах: целое число от 10 до 2000",
    tooLong: (max: number) => `Не больше ${max} символов`,
    knownAndUnknown: "Поле заполнено и одновременно отмечено «не знаю»",
    typeRequired: "Выберите тип мебели или впишите свой вариант",
    chooseOrUnknown: "Выберите вариант или «Не знаю — подскажет исполнитель»",
    segmentRequired: "Выберите уровень мебели",
    cityRequired: "Укажите город",
    addressRequired: "Укажите адрес: его увидит только выбранный исполнитель",
    date: "Укажите дату",
  },
} as const;
