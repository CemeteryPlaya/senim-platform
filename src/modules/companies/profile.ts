import "server-only";
import { z } from "zod";
import type { LegalForm, MeasurementTerms, RegistrationStatus, Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction } from "@/platform/db";
import { assertActiveFurnitureTypes, parseInput, requireExecutor, sanitizePublicText } from "./own";

const t = ru.companies.profile;

export const ABOUT_MAX_LENGTH = 2000;
export const MEASUREMENT_FEE_MIN = 1_000;
export const MEASUREMENT_FEE_MAX = 200_000;

/**
 * Что исполнитель меняет сам. Сегмента здесь нет — его ставит оператор;
 * лишние поля zod отбрасывает. Плата за выезд — только при FEE_IF_NO_DEAL.
 */
export const profileInputSchema = z
  .object({
    about: z.string().trim().max(ABOUT_MAX_LENGTH, t.errors.aboutTooLong(ABOUT_MAX_LENGTH)),
    yearsExperience: z.number(t.errors.experience).int(t.errors.experience).min(0, t.errors.experience).max(60, t.errors.experience),
    specializationIds: z.array(z.string().min(1)).max(30),
    measurementTerms: z.enum(["FREE", "INCLUDED", "FEE_IF_NO_DEAL"]),
    measurementFee: z.number().int().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.measurementTerms !== "FEE_IF_NO_DEAL") return;
    const fee = v.measurementFee;
    if (fee === null || fee < MEASUREMENT_FEE_MIN || fee > MEASUREMENT_FEE_MAX) {
      ctx.addIssue({ code: "custom", path: ["measurementFee"], message: t.errors.fee(MEASUREMENT_FEE_MIN, MEASUREMENT_FEE_MAX) });
    }
  })
  .transform((v) => ({
    ...v,
    specializationIds: [...new Set(v.specializationIds)],
    measurementFee: v.measurementTerms === "FEE_IF_NO_DEAL" ? v.measurementFee : null,
  }));

export type ProfileInput = z.input<typeof profileInputSchema>;

export type OwnProfile = {
  publicNumber: number;
  label: string;
  status: RegistrationStatus;
  rejectReason: string | null;
  segment: Segment | null;
  legalForm: LegalForm;
  legalName: string;
  about: string;
  yearsExperience: number;
  specializationIds: string[];
  measurementTerms: MeasurementTerms;
  measurementFee: number | null;
  ratingAvg: number;
  reviewsCount: number;
  completedDeals: number;
};

/** Свой профиль исполнителя (с наименованием — его видит только он сам и договор). */
export async function getOwnProfile(user: CurrentUser): Promise<OwnProfile> {
  const { executorId } = requireExecutor(user);
  const p = await db.executorProfile.findUniqueOrThrow({
    where: { id: executorId },
    include: { specializations: { select: { id: true } } },
  });
  return {
    publicNumber: p.publicNumber,
    label: ru.common.executorLabel(p.publicNumber),
    status: p.status,
    rejectReason: p.rejectReason,
    segment: p.segment,
    legalForm: p.legalForm,
    legalName: p.legalName,
    about: p.about,
    yearsExperience: p.yearsExperience,
    specializationIds: p.specializations.map((s) => s.id),
    measurementTerms: p.measurementTerms,
    measurementFee: p.measurementFee,
    ratingAvg: p.ratingAvg,
    reviewsCount: p.reviewsCount,
    completedDeals: p.completedDeals,
  };
}

/** Сохранение профиля. aboutMasked — из «о себе» убраны контакты или наименование (показать пояснение); about — сохранённый текст. */
export async function updateProfile(user: CurrentUser, raw: ProfileInput): Promise<{ aboutMasked: boolean; about: string }> {
  const { executorId } = requireExecutor(user);
  const input = parseInput(profileInputSchema, raw);

  return transaction(async (tx) => {
    await assertActiveFurnitureTypes(tx, input.specializationIds);
    const about = await sanitizePublicText(tx, executorId, input.about);
    const before = await tx.executorProfile.findUniqueOrThrow({
      where: { id: executorId },
      select: { yearsExperience: true, measurementTerms: true, measurementFee: true, specializations: { select: { id: true } } },
    });
    await tx.executorProfile.update({
      where: { id: executorId },
      data: {
        about: about.text,
        yearsExperience: input.yearsExperience,
        measurementTerms: input.measurementTerms,
        measurementFee: input.measurementFee,
        specializations: { set: input.specializationIds.map((id) => ({ id })) },
      },
    });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "executor.profile.updated",
      entity: { type: "executor", id: executorId },
      scope: `executor:${executorId}`,
      before: { ...before, specializations: before.specializations.map((s) => s.id) },
      after: {
        yearsExperience: input.yearsExperience,
        measurementTerms: input.measurementTerms,
        measurementFee: input.measurementFee,
        specializations: input.specializationIds,
        aboutMasked: about.masked,
      },
    });
    return { aboutMasked: about.masked, about: about.text };
  });
}

/** Справочник типов мебели (включённые, по порядку оператора) — для форм и фильтров. */
export async function listFurnitureTypes(): Promise<{ id: string; slug: string; name: string }[]> {
  return db.furnitureType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true } });
}
