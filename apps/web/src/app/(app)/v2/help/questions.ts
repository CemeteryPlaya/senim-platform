import { ru } from "@/i18n/ru";
import { to } from "../../_shell/paths";
import { HELP_ANCHORS, type HelpAnchor } from "./anchors";

const h = ru.app.profile.help;

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
