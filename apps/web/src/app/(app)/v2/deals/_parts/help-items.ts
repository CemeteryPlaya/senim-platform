import { ru } from "@/i18n/ru";
import { to } from "../../../_shell/paths";
import { HELP_ANCHORS } from "../../help/anchors";

/** Вопросы «Помощи» на экранах сделок покупателя (список и карточка): про деньги и «если не понравится». */
export const dealHelpItems = (): { question: string; href: string }[] => [
  { question: ru.app.deal.card.help.money, href: `${to("/help")}#${HELP_ANCHORS.money}` },
  { question: ru.app.deal.card.help.notLiked, href: `${to("/help")}#${HELP_ANCHORS.notFit}` },
];
