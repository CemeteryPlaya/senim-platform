import { SkeletonCard, SkeletonChips, SkeletonRows, SkeletonScreen, SkeletonTitle } from "@/kit";

/** Каркас заявок мастера (аудит поведения B-3): заголовок, фильтры, список заявок и «Мои предложения». */
export default function IncomingLoading() {
  return (
    <SkeletonScreen className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <SkeletonTitle />
      <SkeletonChips count={3} />
      <SkeletonRows rows={3} />
      <SkeletonCard lines={1} />
    </SkeletonScreen>
  );
}
