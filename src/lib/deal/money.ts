export const COMMISSION_RATE = 0.06;

/** Разбивка выплаты: сколько уходит исполнителю, сколько — комиссия оператора. */
export function split(gross: number, rate = COMMISSION_RATE) {
  const commission = Math.round(gross * rate);
  return { gross, commission, net: gross - commission };
}

/** Сумма транша, раскрываемого при подтверждении этапа. */
export function trancheFor(amount: number, payoutPercent: number) {
  return Math.round((amount * payoutPercent) / 100);
}

/** Шаблон этапов изготовления корпусной мебели. Последний этап забирает остаток суммы. */
export function defaultStages(advancePercent: number) {
  return [
    {
      title: "Замер и проект",
      description: "Выезд на замер, согласование эскиза и 3D-проекта, спецификация материалов.",
      payoutPercent: 0,
    },
    {
      title: "Закупка материалов",
      description: "ЛДСП, фасады, столешница, фурнитура. Мастер прикладывает фото и чеки.",
      payoutPercent: advancePercent,
    },
    {
      title: "Изготовление в цеху",
      description: "Раскрой, кромление, сверление, предварительная сборка корпусов.",
      payoutPercent: 0,
    },
    {
      title: "Доставка, монтаж и сдача",
      description: "Доставка, установка на объекте, регулировка фасадов, финальная приёмка.",
      payoutPercent: 100 - advancePercent,
    },
  ];
}
