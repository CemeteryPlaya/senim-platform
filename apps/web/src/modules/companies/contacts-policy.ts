import type { ChatParty } from "./chat-policy";

/**
 * Контакты сторон (ТЗ п. 3, решение 2.2.10, ADR-009 §7): телефон и Instagram обеих сторон скрыты
 * до заключения оферты — Deal.signedAt (оферту подписали обе стороны). После — видны обеим сторонам
 * этой сделки. Правило одно — эта таблица; чат и карточка сделки её не дублируют.
 */
export type ContactStage = "BEFORE_OFFER" | "AFTER_OFFER";

export function contactStage(deal: { signedAt: Date | null } | null): ContactStage {
  return deal?.signedAt ? "AFTER_OFFER" : "BEFORE_OFFER";
}

/**
 * Что чат делает с текстом стороны перед записью:
 * - maskContacts — телефоны, e-mail, ссылки, @ники и мессенджеры заменяются маской (исходный текст не хранится);
 * - maskContactsAndName — то же и наименование/ФИО исполнителя (анонимность «Исполнитель №N»);
 * - asIs — без маски: оферта заключена, стороны и так видят контакты и наименование друг друга.
 */
export type ChatTextRule = "maskContacts" | "maskContactsAndName" | "asIs";
type Writer = Exclude<ChatParty, "operator">;

/**
 * | стадия        | текст заказчика | текст исполнителя      | контакты другой стороны            |
 * |---------------|-----------------|------------------------|------------------------------------|
 * | до оферты     | maskContacts    | maskContactsAndName    | никому (оператор — в своей панели) |
 * | после оферты  | asIs            | asIs                   | заказчику и исполнителю сделки     |
 *
 * Сообщения, записанные до оферты, остаются маскированными: исходный текст не хранился.
 * Показ телефона заказчика до оферты по согласию — отдельное правило под флагом (phone-policy.ts).
 */
export const CONTACTS = {
  BEFORE_OFFER: {
    text: { client: "maskContacts", executor: "maskContactsAndName" },
    contacts: { client: false, executor: false, operator: false },
  },
  AFTER_OFFER: {
    text: { client: "asIs", executor: "asIs" },
    contacts: { client: true, executor: true, operator: false },
  },
} as const satisfies Record<ContactStage, { text: Record<Writer, ChatTextRule>; contacts: Record<ChatParty, boolean> }>;

export function chatTextRule(stage: ContactStage, party: Writer): ChatTextRule {
  return CONTACTS[stage].text[party];
}

export function seesPartyContacts(stage: ContactStage, party: ChatParty): boolean {
  return CONTACTS[stage].contacts[party];
}
