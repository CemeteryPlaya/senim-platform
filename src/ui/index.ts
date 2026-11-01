// Публичный API дизайн-системы «Сенім». Экраны импортируют только отсюда: `import { Button } from "@/ui"`.
// Шрифты — отдельно (`@/ui/fonts`), их подключает только корневой layout.

export { cn } from "./cn";
export { focusFirstInvalid } from "./focus";
export {
  formatDate,
  formatDateTime,
  formatDays,
  formatMoney,
  formatMonths,
  formatRelative,
  formatTime,
  formatYears,
  TIME_ZONE,
  type DateInput,
} from "./format";

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
  SimulatorBadge,
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
export { Stepper, type StepperBack, type StepperProps } from "./Stepper";
export { Modal, type ModalProps } from "./Modal";
export { ConfirmDialog, type ConfirmDialogProps, type ConfirmSpec, type ConfirmTone } from "./ConfirmDialog";
export { ConfirmButton, FormError, type ConfirmButtonProps } from "./ConfirmButton";
export { PhotoUpload, type PhotoItem, type PhotoUploadProps } from "./PhotoUpload";
export { Chat, type ChatMessage, type ChatProps } from "./Chat";
