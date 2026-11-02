import type { ProjectStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { ProjectVersion } from "@/modules/requests";
import { Money, StatusBadge, formatDays, formatMonths, type Tone } from "@/ui";

const t = ru.requests.pre.project;

export const PROJECT_TONE: Record<ProjectStatus, Tone> = { SUBMITTED: "warning", APPROVED: "success", CHANGES_REQUESTED: "info" };

/** Версия проекта: материалы, расшифровка стоимости, срок, гарантия, итоговая цена и комментарий заказчика. */
export function ProjectView({ project }: { project: ProjectVersion }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{t.version(project.version)}</span>
        <StatusBadge tone={PROJECT_TONE[project.status]}>{t.status[project.status]}</StatusBadge>
      </p>
      <dl className="facts gap-x-4 gap-y-2 text-base">
        <dt className="text-muted">{t.materials}</dt>
        <dd className="text-ink whitespace-pre-line">{project.materials}</dd>
        <dt className="text-muted">{t.duration}</dt>
        <dd className="text-ink">{formatDays(project.durationDays)}</dd>
        <dt className="text-muted">{t.warranty}</dt>
        <dd className="text-ink">{formatMonths(project.warrantyMonths)}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <h4 className="text-base font-semibold text-ink">{t.costLines}</h4>
        <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
          {project.costLines.map((line, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-base">
              <span className="min-w-0 text-ink">{line.title}</span>
              <Money amount={line.amount} className="font-semibold text-ink" />
            </li>
          ))}
        </ul>
      </div>
      <p className="flex flex-col">
        <span className="text-base text-muted">{t.total}</span>
        <Money amount={project.totalPrice} className="text-3xl font-extrabold text-ink" />
      </p>
      {project.changeNote && (
        <p className="rounded-control bg-sunken p-4 text-base text-ink">
          <span className="font-semibold">{t.clientComment}: </span>
          {project.changeNote}
        </p>
      )}
    </div>
  );
}
