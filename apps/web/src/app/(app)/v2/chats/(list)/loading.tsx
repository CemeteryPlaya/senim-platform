import { SkeletonRows, SkeletonScreen, SkeletonTitle } from "@/kit";

/**
 * Каркас «Чатов» (аудит поведения B-3): заголовок и список диалогов с монограммами; на компьютере — две панели, как у
 * `ChatPanes` (список слева, место переписки справа).
 */
export default function ChatsLoading() {
  return (
    <SkeletonScreen className="desktop:grid desktop:grid-cols-chats desktop:grid-rows-1 desktop:gap-split desktop:screen-fill">
      <div className="flex min-w-0 flex-col gap-stack-section">
        <SkeletonTitle />
        <SkeletonRows rows={3} leading />
      </div>
      <div aria-hidden className="hidden rounded-card bg-surface desktop:block" />
    </SkeletonScreen>
  );
}
