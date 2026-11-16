import { SkeletonCard, SkeletonRows, SkeletonScreen, SkeletonTitle, Split } from "@/kit";

/** Каркас профиля (аудит поведения B-3): имя и телефон, разделы; справа (на телефоне — ниже) оформление и роль. */
export default function ProfileLoading() {
  return (
    <SkeletonScreen>
      <SkeletonTitle />
      <Split
        main={
          <div className="flex flex-col gap-stack-section">
            <SkeletonCard lines={2} />
            <SkeletonRows rows={4} />
          </div>
        }
        aside={
          <div className="flex flex-col gap-stack-section">
            <SkeletonCard lines={1} />
            <SkeletonRows rows={1} />
          </div>
        }
      />
    </SkeletonScreen>
  );
}
