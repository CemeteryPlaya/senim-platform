/**
 * Якоря «О сервисе»: стабильные латинские id разделов. Одно место для обеих страниц — главная ссылается на них
 * из «Помощи», а `/v2/about` ставит их на заголовки разделов.
 */
export const ABOUT_ANCHORS = {
  money: "money",
  price: "price",
  refusal: "refusal",
  master: "master",
} as const;

export type AboutAnchor = keyof typeof ABOUT_ANCHORS;
