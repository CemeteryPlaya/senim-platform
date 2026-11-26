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
export type CompanyNow = { title: string; body?: string; next?: string; fixHref?: string; fixLabel?: string };

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

export type SectionLink = { label: string; href: string };

/**
 * Разделы под карточкой — только у неодобренного мастера: документы, счёт и портфолио (их можно заполнять до проверки).
 * У одобренного те же строки (и финансы) стоят на экране «Профиль», откуда он сюда пришёл, — здесь их нет (`[]`).
 */
export function sectionLinks(status: RegistrationStatus): SectionLink[] {
  if (status === "APPROVED") return [];
  const s = t.sections;
  const links: SectionLink[] = [
    { label: s.documents, href: to("/executor/profile/kyc") },
    { label: s.payout, href: to("/executor/profile/payout") },
    { label: s.portfolio, href: to("/executor/portfolio") },
  ];
  return links;
}

/** «Назад» с документов, счёта и портфолио: одобренному — «Профиль» (разделы там), иначе — «Компания» (корневая вкладка). */
export function masterBack(approved: boolean): { href: string; label: string } {
  const s = ru.app.masterCompany.shared;
  return approved ? { href: to("/profile"), label: s.backProfile } : { href: to("/executor/profile"), label: s.backCompany };
}

/** Публичная страница мастера: только у одобренного (до проверки покупатели его не видят). */
export function publicHref(profile: Pick<CompanyProfile, "status" | "publicNumber">): string | null {
  return profile.status === "APPROVED" ? to(`/executors/${profile.publicNumber}`) : null;
}

/** Плата за выезд для показа: «10 000» с разделителем разрядов (в том числе неразрывным); не число — как ввели. */
export function formatFee(raw: string): string {
  const clean = raw.replace(/[\s ]/g, "");
  if (clean === "" || !/^\d+$/.test(clean)) return raw;
  return Number(clean).toLocaleString("ru-RU");
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
    fee: profile.measurementFee === null ? "" : formatFee(String(profile.measurementFee)),
    city: profile.city,
    district: profile.district,
    streetAddress: profile.streetAddress,
  };
}
