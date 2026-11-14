import { HELP_ANCHORS } from "../../help/anchors";
import { helpItem } from "../../help/questions";

/** Вопросы «Помощи» на экранах сделок покупателя (список и карточка): про деньги и «если не подошла» — дословно как разделы «Помощи». */
export const dealHelpItems = (): { question: string; href: string }[] => [helpItem(HELP_ANCHORS.money), helpItem(HELP_ANCHORS.notFit)];
