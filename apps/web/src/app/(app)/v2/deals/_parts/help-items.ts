import type { DealSide } from "../../../_shell/side";
import { HELP_ANCHORS } from "../../help/anchors";
import { helpItem } from "../../help/questions";

/**
 * Вопросы «Помощи» на экранах сделок (список и карточка). Покупателю — про деньги и «если не подошла» — дословно как
 * разделы «Помощи». Разделы «Помощи» написаны для покупателя, поэтому мастеру вопросов нет — только связь с поддержкой.
 */
export const dealHelpItems = (side: DealSide = "CLIENT"): { question: string; href: string }[] =>
  side === "EXECUTOR" ? [] : [helpItem(HELP_ANCHORS.money), helpItem(HELP_ANCHORS.notFit)];
