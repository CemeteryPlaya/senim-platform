// Клиентская точка входа identity (без server-only): разбор результата Server Action в формах.
export { askSecondFactor, leaveIfSignedOut } from "./session-expiry";
// Чистые проверки ИИН/БИН и ФИО — для проверки полей анкеты в браузере (те же правила, что у схем модуля).
export { isValidBin, isValidIin } from "./kz-id";
export { isValidFullName } from "./full-name";
