import type { ProjectStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { ProjectVersion } from "@/modules/requests";
import { StatusBadge, type Tone } from "@/ui";
import { CostSummary } from "./CostSummary";

const t = ru.requests.pre.project;

export const PROJECT_TONE: Record<ProjectStatus, Tone> = { SUBMITTED: "warning", APPROVED: "success", CHANGES_REQUESTED: "info" };

/**
 * Версия проекта по макету 8 («Детали проекта»): материалы, итоговая стоимость с расшифровкой и мятной строкой
 * «Итого», плитки срока и гарантии, комментарий заказчика.
 */
export function ProjectView({ project }: { project: ProjectVersion }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{t.version(project.version)}</span>
        <StatusBadge tone={PROJECT_TONE[project.status]}>{t.status[project.status]}</StatusBadge>
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-bold text-ink">{t.materials}</h3>
        <p className="border-l-2 border-line pl-4 text-base whitespace-pre-line text-ink">{project.materials}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-bold text-ink">{t.costTitle}</h3>
        <CostSummary lines={project.costLines} total={project.totalPrice} durationDays={project.durationDays} warrantyMonths={project.warrantyMonths} />
      </div>
      {project.changeNote && (
        <p className="border-l-2 border-line pl-4 text-base text-ink">
          <span className="font-semibold">{t.clientComment}: </span>
          {project.changeNote}
        </p>
      )}
    </div>
  );
}
