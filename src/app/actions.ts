"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, SESSION_COOKIE, type CurrentUser } from "@/lib/session";
import * as deals from "@/lib/deal/service";
import { seedDatabase } from "@/lib/seed-data";
import type { SignMethod } from "@/lib/providers/signature";
import type { DisputeResolution } from "@/generated/prisma/enums";

export type ActionResult = { error?: string } | void;

async function run(fn: (user: CurrentUser) => Promise<unknown>): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Войдите в демо, выбрав персону" };
  try {
    await fn(user);
  } catch (e) {
    if (e instanceof deals.DealError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
}

export async function switchUser(userId: string, redirectTo?: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
  if (redirectTo) redirect(redirectTo);
}

export async function createDealAction(formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Войдите в демо как заказчик" };
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  let id: string;
  try {
    const deal = await deals.createDeal(user, {
      masterId: str("masterId"),
      title: str("title"),
      furnitureType: str("furnitureType"),
      description: str("description"),
      dimensions: str("dimensions"),
      materials: str("materials"),
      color: str("color"),
      address: str("address"),
      amount: Number(str("amount").replace(/\D/g, "")),
      deadline: new Date(str("deadline")),
      advancePercent: Number(str("advancePercent")),
    });
    id = deal.id;
  } catch (e) {
    if (e instanceof deals.DealError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/deals/${id}`);
}

export async function acceptTermsAction(dealId: string) {
  return run((u) => deals.acceptTerms(u, dealId));
}

export async function counterOfferAction(
  dealId: string,
  input: { amount: number; deadline: string; advancePercent: number; comment: string },
) {
  return run((u) => deals.counterOffer(u, dealId, { ...input, deadline: new Date(input.deadline) }));
}

export async function cancelDealAction(dealId: string, reason: string) {
  return run((u) => deals.cancelDeal(u, dealId, reason));
}

export async function signContractAction(dealId: string, method: SignMethod) {
  return run((u) => deals.signContract(u, dealId, method));
}

export async function fundEscrowAction(dealId: string) {
  return run((u) => deals.fundEscrow(u, dealId));
}

export async function submitStageAction(stageId: string, report: string, photos: string[]) {
  return run((u) => deals.submitStage(u, stageId, report, photos.slice(0, 6)));
}

export async function approveStageAction(stageId: string) {
  return run((u) => deals.approveStage(u, stageId));
}

export async function requestReworkAction(stageId: string, note: string) {
  return run((u) => deals.requestRework(u, stageId, note));
}

export async function openDisputeAction(dealId: string, reason: string) {
  return run((u) => deals.openDispute(u, dealId, reason));
}

export async function resolveDisputeAction(disputeId: string, resolution: DisputeResolution, note: string) {
  return run((u) => deals.resolveDispute(u, disputeId, resolution, note));
}

export async function sendMessageAction(dealId: string, text: string, image?: string) {
  return run((u) => deals.sendMessage(u, dealId, text, image));
}

export async function setMasterVerifiedAction(masterId: string, verified: boolean) {
  return run((u) => deals.setMasterVerified(u, masterId, verified));
}

export async function resetDemoAction() {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return { error: "Сброс доступен оператору" };
  await seedDatabase(db);
  revalidatePath("/", "layout");
}
