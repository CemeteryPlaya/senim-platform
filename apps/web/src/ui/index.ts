// Публичный API дизайн-системы «Сенім». Экраны импортируют только отсюда: `import { Button } from "@/ui"`.
// Шрифты — отдельно (`@/ui/fonts`), их подключает только корневой layout.

export { cn } from "./cn";
export { focusFirstInvalid } from "./focus";
export { useFocusInvalid } from "./use-focus-invalid";
export {
  formatDate,
  formatDateTime,
  formatDays,
  formatDeals,
  formatMoney,
  formatMonths,
  formatRelative,
  formatTiyn,
  formatTime,
  formatYears,
  TIME_ZONE,
  type DateInput,
} from "./format";

export { StickyAction, type StickyActionProps } from "./StickyAction";
export { DetailColumns, type DetailColumnsProps } from "./DetailColumns";
export { Button, ButtonLink, buttonClasses, type ButtonLinkProps, type ButtonProps, type ButtonVariant } from "./Button";
export {
  Checkbox,
  Input,
  RadioCards,
  Select,
  Textarea,
  type CheckboxProps,
  type FieldBaseProps,
  type InputProps,
  type RadioCardOption,
  type RadioCardsProps,
  type SelectOption,
  type SelectProps,
  type TextareaProps,
} from "./fields";
export {
  Alert,
  Banner,
  Card,
  Container,
  DateText,
  DemoBanner,
  EmptyState,
  Fact,
  Money,
  PageHeader,
  Skeleton,
  StatusBadge,
  type AlertProps,
  type AlertTone,
  type BannerProps,
  type CardProps,
  type ContainerProps,
  type DateTextProps,
  type EmptyStateProps,
  type PageHeaderProps,
  type SkeletonProps,
  type StatusBadgeProps,
  type Tone,
} from "./display";
export { CategoryTiles, type CategoryTileItem } from "./CategoryTiles";
export { TrustNote } from "./TrustNote";
export { KeyValueList, type KeyValueRow } from "./KeyValueList";
export { StatTiles, type StatTileItem } from "./StatTiles";
export { FilterChips, type FilterChipItem } from "./FilterChips";
export { WorkCard, type WorkCardProps } from "./WorkCard";
export { RequestCard, type RequestCardProps } from "./RequestCard";
export { DealProgress, type DealProgressProps } from "./DealProgress";
export { dealProgressView, type DealProgressView, type ProgressStep } from "./deal-progress";
export { MirrorPayout, type MirrorPayoutProps } from "./MirrorPayout";
export { SignedBadge, type SignedBadgeProps } from "./SignedBadge";
export { FullscreenStep, type FullscreenStepProps } from "./FullscreenStep";
export { Stepper, type StepperBack, type StepperProps } from "./Stepper";
export { Modal, type ModalProps } from "./Modal";
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmSpec, type ConfirmTone } from "./ConfirmDialog";
export { ConfirmButton, FormError, type ConfirmButtonProps } from "./ConfirmButton";
export { PhotoUpload, type PhotoItem, type PhotoUploadProps } from "./PhotoUpload";
export { Chat, type ChatMessage, type ChatProps } from "./Chat";
export {
  LegacyFilterChips,
  LinkList,
  PhotoCard,
  SectionTitle,
  Stat,
  Timeline,
  type LegacyFilterChip,
  type LegacyFilterChipsProps,
  type LinkListItem,
  type PhotoCardProps,
  type SectionTitleProps,
  type StatProps,
  type TimelineItem,
  type TimelineState,
} from "./collections";
