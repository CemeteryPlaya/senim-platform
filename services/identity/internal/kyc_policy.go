package internal

import (
	"slices"
	"strings"

	"connectrpc.com/connect/v2"
)

// Статусы проверки документов (колонка parties.kyc_status). Перенос из
// apps/web/src/modules/identity/kyc-policy.ts; NOT_SUBMITTED в базе хранится явно
// (в web он выводился из «PENDING без файлов»).
const (
	kycNotSubmitted = "NOT_SUBMITTED"
	kycPending      = "PENDING"
	kycVerified     = "VERIFIED"
	kycRejected     = "REJECTED"

	// Не больше стольких файлов каждого вида (KYC_MAX_FILES).
	kycMaxFiles = 4
	// Причина отказа: 3–500 символов после обрезки пробелов (KYC_REASON_MIN/MAX).
	kycReasonMin = 3
	kycReasonMax = 500
)

// subjectKycReviewed — событие KycReviewed (решение оператора по документам).
const subjectKycReviewed = "senim.identity.kyc.reviewed"

// Действия таблицы переходов.
const (
	kycActionSubmit = "submit"
	kycActionVerify = "verify"
	kycActionReject = "reject"
)

// kycTransition — одна строка таблицы переходов: из каких статусов, в какой, кто (активная
// роль) и нужна ли причина.
type kycTransition struct {
	action      string
	from        []string
	to          string
	by          string
	needsReason bool
}

// kycTransitions — единственное место, где определено, что можно делать с проверкой
// документов. Проверенные документы исполнитель не заменяет: новая проверка — через
// оператора. Всё, чего нет в таблице, запрещено.
var kycTransitions = []kycTransition{
	{action: kycActionSubmit, from: []string{kycNotSubmitted, kycPending, kycRejected}, to: kycPending, by: executorRole},
	{action: kycActionVerify, from: []string{kycPending}, to: kycVerified, by: mfaRole},
	{action: kycActionReject, from: []string{kycPending}, to: kycRejected, by: mfaRole, needsReason: true},
}

func kycRule(action string) kycTransition {
	for _, t := range kycTransitions {
		if t.action == action {
			return t
		}
	}
	return kycTransition{}
}

func kycTransitionForbidden() error {
	return rpcError(connect.CodeFailedPrecondition, "kyc_transition_forbidden", nil)
}

func kycDocumentsMissing() error {
	return rpcError(connect.CodeFailedPrecondition, "kyc_documents_missing", nil)
}

func kycReasonInvalid() error {
	return rpcError(connect.CodeInvalidArgument, "kyc_reason_invalid", nil)
}

// kycTarget — куда ведёт действие (kycTarget в kyc-policy.ts): не та роль — role_forbidden;
// не то состояние (повтор, двойной клик, проверенные документы) — kyc_transition_forbidden;
// решение без документов — kyc_documents_missing.
func kycTarget(action, status string, hasDocuments bool, who string) (string, error) {
	rule := kycRule(action)
	if rule.action == "" || who != rule.by {
		return "", roleForbidden()
	}
	if !slices.Contains(rule.from, status) {
		return "", kycTransitionForbidden()
	}
	if action != kycActionSubmit && !hasDocuments {
		return "", kycDocumentsMissing()
	}
	return rule.to, nil
}

// kycReason — причина отказа после обрезки пробелов; ok=false, если вне 3–500 символов.
func kycReason(raw string) (string, bool) {
	r := strings.TrimFunc(raw, jsSpace)
	n := jsLen(r)
	return r, n >= kycReasonMin && n <= kycReasonMax
}
