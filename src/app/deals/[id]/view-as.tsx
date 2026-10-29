"use client";

import clsx from "clsx";
import { Eye } from "lucide-react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchUser } from "@/app/actions";
import { Avatar } from "@/components/ui";

type Party = { id: string; name: string; avatar: string; role: string };

/** Быстрое переключение между сторонами сделки — удобно показывать процесс на одном экране. */
export function ViewAs({ parties, currentId }: { parties: Party[]; currentId: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className={clsx("inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1 text-sm", pending && "opacity-60")}>
      <span className="hidden items-center gap-1 px-2 text-xs text-muted sm:flex">
        <Eye size={14} /> Смотреть как
      </span>
      {parties.map((p) => (
        <button
          key={p.id}
          disabled={pending || p.id === currentId}
          onClick={() =>
            start(async () => {
              await switchUser(p.id);
              router.refresh();
            })
          }
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition",
            p.id === currentId ? "bg-brand text-white" : "hover:bg-ink/5",
          )}
        >
          <Avatar name={p.name} color={p.avatar} size={20} />
          <span className="font-medium">{p.role}</span>
        </button>
      ))}
    </div>
  );
}
