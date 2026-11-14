/** Якоря разделов «Помощи» (`/v2/help#<якорь>`): на них ссылаются главная покупателя и экраны сделок. */
export const HELP_ANCHORS = {
  how: "how",
  price: "price",
  money: "money",
  notFit: "not-fit",
  cancel: "cancel",
  contacts: "contacts",
  support: "support",
} as const;

export type HelpAnchor = (typeof HELP_ANCHORS)[keyof typeof HELP_ANCHORS];
