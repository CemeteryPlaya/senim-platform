import { ru } from "@/i18n/ru";
import { to } from "../../_shell/paths";
import { HELP_ANCHORS, MASTER_HELP_ANCHORS, type HelpAnchor, type MasterHelpAnchor } from "./anchors";

const h = ru.app.profile.help;
const mh = ru.app.masterProfile.help;

/** Заголовок раздела «Помощи» по якорю — он же вопрос в блоках помощи на других экранах (дословно, одним источником). */
const TITLES: Record<HelpAnchor, string> = {
  [HELP_ANCHORS.how]: h.how.title,
  [HELP_ANCHORS.price]: h.price.title,
  [HELP_ANCHORS.money]: h.money.title,
  [HELP_ANCHORS.notFit]: h.notFit.title,
  [HELP_ANCHORS.cancel]: h.cancel.title,
  [HELP_ANCHORS.contacts]: h.contacts.title,
  [HELP_ANCHORS.support]: h.support.title,
};

/** Вопрос блока помощи (`HelpBlock`): текст — заголовок раздела «Помощи», ссылка — на этот раздел. */
export const helpItem = (anchor: HelpAnchor): { question: string; href: string } => ({ question: TITLES[anchor], href: `${to("/help")}#${anchor}` });

/** Заголовки разделов «Помощи» мастера по якорю (`MasterHelp`): они же вопросы в блоках помощи на экранах мастера. */
const MASTER_TITLES: Record<MasterHelpAnchor, string> = {
  [MASTER_HELP_ANCHORS.requests]: mh.requests.title,
  [MASTER_HELP_ANCHORS.price]: mh.price.title,
  [MASTER_HELP_ANCHORS.money]: mh.money.title,
  [MASTER_HELP_ANCHORS.dispute]: mh.dispute.title,
  [MASTER_HELP_ANCHORS.contacts]: mh.contacts.title,
  [MASTER_HELP_ANCHORS.support]: mh.support.title,
};

/** Вопрос блока помощи на экране мастера: текст — заголовок раздела «Помощи» мастера, ссылка — на этот раздел. */
export const masterHelpItem = (anchor: MasterHelpAnchor): { question: string; href: string } => ({
  question: MASTER_TITLES[anchor],
  href: `${to("/help")}#${anchor}`,
});
