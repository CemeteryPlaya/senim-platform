import { ru } from "@/i18n/ru";
import type { MeasurementTerms, RegistrationStatus } from "@/generated/prisma/enums";
import { to } from "../../../../_shell/paths";

// Что показывает экран «Компания»: чистые функции над профилем мастера (без сервера и React).

const t = ru.app.masterCompany.company;

/** Профиль так, как его читает экран (подмножество `OwnProfile` модуля companies). */
export type CompanyProfile = {
  publicNumber: number;
  label: string;
  status: RegistrationStatus;
  rejectReason: string | null;
  legalName: string;
  about: string;
  yearsExperience: number;
  specializationIds: string[];
  measurementTerms: MeasurementTerms;
  measurementFee: number | null;
  city: string;
  district: string;
  streetAddress: string;
};

/** Карточка «Сейчас / Дальше» по статусу профиля. После отказа — ссылка на анкету. */
export type CompanyNow = { title: string; body?: string; next: string; fixHref?: string; fixLabel?: string };

export function companyNow(profile: Pick<CompanyProfile, "status" | "rejectReason">): CompanyNow {
  switch (profile.status) {
    case "PENDING":
      return { ...t.now.PENDING };
    case "REJECTED":
      return {
        title: t.now.REJECTED.title,
        body: profile.rejectReason ? t.now.REJECTED.reason(profile.rejectReason) : t.now.REJECTED.noReason,
        next: t.now.REJECTED.next,
        fixHref: `${to("/register/executor")}?step=form`,
        fixLabel: t.now.REJECTED.action,
      };
    case "APPROVED":
      return { ...t.now.APPROVED };
  }
}

/** «Астана, Есильский район»: город и район через запятую; пусто — null. Улицу и дом покупатель до оферты не видит. */
export function placeLine(profile: Pick<CompanyProfile, "city" | "district">): string | null {
  const line = [profile.city, profile.district].filter((part) => part !== "").join(", ");
  return line === "" ? null : line;
}

export type SectionLink = { label: string; href: string };

/**
 * Разделы под карточкой: документы, счёт и портфолио — всегда (их можно заполнять до проверки); финансы — только у
 * одобренного мастера.
 */
export function sectionLinks(status: RegistrationStatus): SectionLink[] {
  const s = t.sections;
  const links: SectionLink[] = [
    { label: s.documents, href: to("/executor/profile/kyc") },
    { label: s.payout, href: to("/executor/profile/payout") },
    { label: s.portfolio, href: to("/executor/portfolio") },
  ];
  if (status === "APPROVED") links.push({ label: s.finance, href: to("/executor/finance") });
  return links;
}

/** Публичная страница мастера: только у одобренного (до проверки покупатели его не видят). */
export function publicHref(profile: Pick<CompanyProfile, "status" | "publicNumber">): string | null {
  return profile.status === "APPROVED" ? to(`/executors/${profile.publicNumber}`) : null;
}

/** Начальные значения формы: все поля — строки (число — как его вводят). */
export type CompanyValues = {
  about: string;
  years: string;
  specializationIds: string[];
  terms: MeasurementTerms;
  fee: string;
  city: string;
  district: string;
  streetAddress: string;
};

export function initialValues(profile: CompanyProfile): CompanyValues {
  return {
    about: profile.about,
    years: String(profile.yearsExperience),
    specializationIds: profile.specializationIds,
    terms: profile.measurementTerms,
    fee: profile.measurementFee === null ? "" : String(profile.measurementFee),
    city: profile.city,
    district: profile.district,
    streetAddress: profile.streetAddress,
  };
}
