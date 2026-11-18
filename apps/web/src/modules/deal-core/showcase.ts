import type { ShowcaseAddress, ShowcaseSignature } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { actorOf, publicSignatureOf, type CurrentUser } from "@/modules/identity";
import { db, lockDealRow, transaction, type Db, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { isEndedSigned } from "./ended";
import { addressOptionsOf } from "./ports";
import { showcaseSchema, type ShowcaseInput } from "./schemas";
import { requireParty, requireRole, scopeOf } from "./state";

/**
 * Выбор покупателя: что из оконченной сделки с офертой видно в публичном профиле мастера (спека 2026-11-17, 3.5) —
 * фото сдачи, стоимость, адрес (город / район / ЖК, улица — никогда), подпись отзыва (имя или инициал).
 * Хранится при сделке (DealShowcase) с редакцией текста вопроса, временем и автором; каждое изменение — в журнал аудита
 * (deal.showcase.changed, только выбор — без имени). Подпись — снимок из ФИО проекции User в момент выбора: гостю
 * страницы мастера identity не нужен. Нет строки — закрытый вид. Отзыв согласия на ПДн — closeShowcasesOf.
 */

/** Редакция текста вопроса «что показать» (ru.app.deal.showcase): записывается с каждым выбором. */
export const SHOWCASE_TEXT_VERSION = "2026-11-18";

export type ShowcaseChoice = { photos: boolean; price: boolean; address: ShowcaseAddress; signature: ShowcaseSignature };

export type ShowcaseView = ShowcaseChoice & {
  /** Снимок подписи: «Айгерим», «А.» или пусто (ФИО нет — отзыв на странице мастера без подписи). */
  signedAs: string;
  /** Покупатель уже отвечал (есть запись выбора); нет — показан закрытый вид по умолчанию. */
  answered: boolean;
  /** Поменять может только покупатель этой сделки и только когда она окончена с офертой. */
  changeable: boolean;
  /** Доступные варианты адреса: район — если он есть в заявке, ЖК — если есть и район, и ЖК. */
  addressOptions: ShowcaseAddress[];
};

/** Самое закрытое: без фото, стоимости и адреса, подпись — инициал. Так до ответа покупателя и после отзыва согласия на ПДн. */
export const CLOSED_SHOWCASE: ShowcaseChoice = { photos: false, price: false, address: "NONE", signature: "INITIAL" };

const choiceOf = (row: ShowcaseChoice): ShowcaseChoice => ({ photos: row.photos, price: row.price, address: row.address, signature: row.signature });
const sameChoice = (a: ShowcaseChoice, b: ShowcaseChoice) => a.photos === b.photos && a.price === b.price && a.address === b.address && a.signature === b.signature;

const SHOWCASE_SELECT = { photos: true, price: true, address: true, signature: true, signedAs: true, textVersion: true } as const;

async function dealForShowcase(client: Db, dealId: string) {
  return client.deal.findUnique({
    where: { id: dealId },
    select: {
      clientId: true,
      executorId: true,
      status: true,
      signedAt: true,
      request: { select: { district: true, complex: true } },
      showcase: { select: SHOWCASE_SELECT },
    },
  });
}

/** Выбор сделки для экранов сторон и оператора; чужая или несуществующая — NOT_FOUND. */
export async function getDealShowcase(user: CurrentUser, dealId: string): Promise<ShowcaseView> {
  const deal = await dealForShowcase(db, dealId);
  if (!deal) return fail.notFound(ru.deal.errors.notFound);
  const role = requireRole(user, deal);
  const row = deal.showcase;
  return {
    ...(row ? choiceOf(row) : CLOSED_SHOWCASE),
    signedAs: row?.signedAs ?? "",
    answered: row !== null,
    changeable: role === "CLIENT" && isEndedSigned(deal),
    addressOptions: addressOptionsOf(deal.request),
  };
}

/**
 * Покупатель сохраняет выбор. Строка сделки блокируется (SELECT … FOR UPDATE): двойное нажатие и параллельные запросы
 * идут по очереди, повтор с тем же выбором ничего не пишет. Подпись NAME без ФИО невозможна — сохраняется инициал (пустой).
 */
export async function setDealShowcase(user: CurrentUser, raw: ShowcaseInput): Promise<void> {
  const input = parseInput(showcaseSchema, raw);
  await transaction(async (tx) => {
    if (!(await lockDealRow(tx, input.dealId))) return fail.notFound(ru.deal.errors.notFound);
    const deal = await dealForShowcase(tx, input.dealId);
    if (!deal) return fail.notFound(ru.deal.errors.notFound);
    requireParty(user, deal, "CLIENT");
    if (!isEndedSigned(deal)) return fail.conflict(ru.deal.errors.showcaseOnlyEnded);
    if (!addressOptionsOf(deal.request).includes(input.address)) return fail.validation(ru.deal.validation.showcaseAddress, { field: "address" });

    const person = await tx.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    let signedAs = publicSignatureOf(person?.fullName, input.signature);
    const signature: ShowcaseSignature = signedAs === "" ? "INITIAL" : input.signature;
    const after: ShowcaseChoice = { photos: input.photos, price: input.price, address: input.address, signature };
    const prev = deal.showcase;
    if (prev && sameChoice(prev, after) && prev.textVersion === SHOWCASE_TEXT_VERSION) return;
    // Выбор не менял подпись — снимок прежний: имя в проекции могло смениться, а покупатель подписи не касался.
    if (prev && prev.signature === signature && prev.signedAs !== "") signedAs = prev.signedAs;

    const data = { ...after, signedAs, textVersion: SHOWCASE_TEXT_VERSION, updatedById: user.id };
    await tx.dealShowcase.upsert({ where: { dealId: input.dealId }, create: { dealId: input.dealId, ...data }, update: data });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "deal.showcase.changed",
      entity: { type: "deal", id: input.dealId },
      scope: scopeOf(input.dealId),
      before: prev ? choiceOf(prev) : undefined,
      after,
      meta: { textVersion: SHOWCASE_TEXT_VERSION },
    });
  });
}

const REVOCATION_ACTOR = SYSTEM("consent-revocation");
/** Автор изменения в DealShowcase.updatedById, когда показ закрыл исполненный отзыв согласия, а не сам покупатель. */
const REVOCATION_UPDATER = "system:consent-revocation";

/** Снимок подписи «имя» → инициал этого же снимка («Айгерим» → «А.»); инициал и пустая — как есть. */
function initialOf(row: { signature: ShowcaseSignature; signedAs: string }): string {
  if (row.signature === "INITIAL" || row.signedAs === "") return row.signedAs;
  return `${Array.from(row.signedAs)[0]}.`;
}

/**
 * Отзыв согласия на обработку ПДн (ADR-014) исполнен: все выборы человека как покупателя — к закрытому виду, подпись —
 * инициал. В транзакции вызывающего; каждая сделка — под блокировкой строки (порядок по id — без взаимных блокировок),
 * так что параллельное сохранение выбора не откроет показ снова. Возвращает число закрытых; повтор — 0, журнал не пишет.
 */
export async function closeShowcasesOf(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.dealShowcase.findMany({ where: { deal: { clientId: userId } }, select: { dealId: true }, orderBy: { dealId: "asc" } });
  let closed = 0;
  for (const { dealId } of rows) {
    await lockDealRow(tx, dealId);
    const row = await tx.dealShowcase.findUnique({ where: { dealId }, select: SHOWCASE_SELECT });
    // Закрытый выбор — это подпись-инициал: снимок уже инициал или пуст.
    if (!row || sameChoice(row, CLOSED_SHOWCASE)) continue;
    await tx.dealShowcase.update({ where: { dealId }, data: { ...CLOSED_SHOWCASE, signedAs: initialOf(row), updatedById: REVOCATION_UPDATER } });
    await recordAudit(tx, {
      actor: REVOCATION_ACTOR,
      action: "deal.showcase.changed",
      entity: { type: "deal", id: dealId },
      scope: scopeOf(dealId),
      before: choiceOf(row),
      after: CLOSED_SHOWCASE,
      meta: { reason: "pd_consent_revoked" },
    });
    closed += 1;
  }
  return closed;
}
