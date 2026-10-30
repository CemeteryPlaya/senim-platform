import { Alert } from "@/ui";

/** Итог отправки формы: ошибка — сразу диктору, успех — вежливо. */
export function FormStatus({ error, done, doneText }: { error?: string; done?: boolean; doneText?: string }) {
  if (error) {
    return (
      <Alert tone="danger" live="assertive">
        {error}
      </Alert>
    );
  }
  if (done && doneText) {
    return (
      <Alert tone="success" live="polite">
        {doneText}
      </Alert>
    );
  }
  return null;
}
