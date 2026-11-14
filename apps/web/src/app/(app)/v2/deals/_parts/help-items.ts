import type { DealSide } from "../../../_shell/side";
import { HELP_ANCHORS, MASTER_HELP_ANCHORS } from "../../help/anchors";
import { helpItem, masterHelpItem } from "../../help/questions";

/**
 * Вопросы «Помощи» на экранах сделок (список и карточка), дословно как разделы «Помощи» своей стороны. Покупателю — про
 * деньги и «если не подошла»; мастеру — про деньги и спор (`MasterHelp`): «Помощь» мастера — свой набор разделов.
 */
export const dealHelpItems = (side: DealSide = "CLIENT"): { question: string; href: string }[] =>
  side === "EXECUTOR"
    ? [masterHelpItem(MASTER_HELP_ANCHORS.money), masterHelpItem(MASTER_HELP_ANCHORS.dispute)]
    : [helpItem(HELP_ANCHORS.money), helpItem(HELP_ANCHORS.notFit)];
