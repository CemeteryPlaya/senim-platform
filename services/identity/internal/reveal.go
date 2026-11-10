package internal

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	// maxRevealUsers — сколько субъектов раскрывается одним вызовом (стороны сделки — двое).
	maxRevealUsers = 50
	// maxReferenceID — предел длины reference_id (идентификатор сделки или операции).
	maxReferenceID = 128
)

// revealPurposeName — цель раскрытия для аудита («REVEAL_PURPOSE_CONTRACT» → «CONTRACT»);
// ok=false для UNSPECIFIED и неизвестных значений.
func revealPurposeName(p identityv1.RevealPurpose) (string, bool) {
	switch p {
	case identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT:
		return "CONTRACT", true
	case identityv1.RevealPurpose_REVEAL_PURPOSE_RELEASE_RECEIPT:
		return "RELEASE_RECEIPT", true
	case identityv1.RevealPurpose_REVEAL_PURPOSE_PAYOUT:
		return "PAYOUT", true
	}
	return "", false
}

// revealIDs разбирает список субъектов: 1–50 UUID, повторы убираются (порядок первого
// появления сохраняется).
func revealIDs(raw []string) ([]uuid.UUID, bool) {
	if len(raw) == 0 || len(raw) > maxRevealUsers {
		return nil, false
	}
	seen := make(map[uuid.UUID]struct{}, len(raw))
	ids := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		id, err := uuid.Parse(r)
		if err != nil {
			return nil, false
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, true
}

// revealMetaJSON — after_json события pii.revealed: цель, ссылка, имена раскрытых полей и
// найден ли пользователь. Значений нет.
type revealMetaJSON struct {
	Purpose     string   `json:"purpose"`
	ReferenceID string   `json:"reference_id"`
	Fields      []string `json:"fields"`
	Found       bool     `json:"found"`
}

// revealedFields — имена непустых раскрытых полей (как в PartyDetails).
func revealedFields(d *identityv1.PartyDetails) []string {
	fields := []string{}
	for _, f := range []struct{ name, value string }{
		{"full_name", d.GetFullName()},
		{"iin", d.GetIin()},
		{"legal_name", d.GetLegalName()},
		{"bin_iin", d.GetBinIin()},
		{"signer_full_name", d.GetSignerFullName()},
		{"signer_iin", d.GetSignerIin()},
		{"payout_iban", d.GetPayoutIban()},
	} {
		if f.value != "" {
			fields = append(fields, f.name)
		}
	}
	return fields
}

// RevealPartyDetails выдаёт открытые ФИО, ИИН, реквизиты и IBAN — для договора,
// квитанции о выпуске денег и выплаты (единственный путь к открытым значениям). purpose
// обязателен (reveal_purpose_invalid), reference_id — тоже. Действующее лицо — пользователь
// сессии actor_session_token или, если её нет (фоновая оплата и выплата), вызывающий
// сервис («service:web»); сессия оператора — только с пройденным вторым фактором.
//
// Чтение и аудит — в одной транзакции: на каждого субъекта событие pii.revealed (цель,
// ссылка, имена полей, без значений). Неизвестный пользователь пропускается без ошибки
// (сделка могла пережить пользователя), но попадает в аудит с found=false.
func (s *Service) RevealPartyDetails(ctx context.Context, req *identityv1.RevealPartyDetailsRequest) (*identityv1.RevealPartyDetailsResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "reveal_party_details"
	purpose, ok := revealPurposeName(req.GetPurpose())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "reveal_purpose_invalid", nil)
	}
	ref := req.GetReferenceId()
	if ref == "" || len(ref) > maxReferenceID {
		return nil, invalidRequest()
	}
	ids, ok := revealIDs(req.GetUserIds())
	if !ok {
		return nil, invalidRequest()
	}
	actor := auditActor{kind: "service", id: callerOf(ctx)}
	if token := req.GetActorSessionToken(); token != "" {
		sess, user, err := s.liveSession(ctx, op, token)
		if err != nil {
			return nil, err
		}
		role := activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
		if role == mfaRole && !sess.MfaVerifiedAt.Valid {
			return nil, mfaRequired()
		}
		actor = userActor(user, role)
	}

	resp := &identityv1.RevealPartyDetailsResponse{}
	err := dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.now()
		for _, id := range ids {
			d, found, err := s.partyDetails(ctx, q, id)
			if err != nil {
				return err
			}
			meta := revealMetaJSON{Purpose: purpose, ReferenceID: ref, Fields: []string{}, Found: found}
			if found {
				meta.Fields = revealedFields(d)
				resp.Parties = append(resp.Parties, d)
			}
			if err := writeAudit(ctx, tx, actor, id.String(), "pii.revealed", nil, meta, now); err != nil {
				return err
			}
		}
		return nil
	})
	var ce *connect.Error
	if errors.As(err, &ce) {
		return nil, err
	}
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	return resp, nil
}

// partyDetails — открытые данные пользователя id: личность и сторона, если есть.
// found=false — пользователя нет.
func (s *Service) partyDetails(ctx context.Context, q *store.Queries, id uuid.UUID) (*identityv1.PartyDetails, bool, error) {
	if _, err := q.GetUserByID(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	} else if err != nil {
		return nil, false, err
	}
	person, err := personOf(ctx, q, id)
	if err != nil {
		return nil, false, err
	}
	d := &identityv1.PartyDetails{UserId: id.String(), FullName: person.FullName.String}
	if person.IinEnc.Valid {
		if d.Iin, err = s.openPII(ctx, person.IinEnc.String, personIINAAD(id)); err != nil {
			return nil, false, err
		}
	}
	p, err := q.GetParty(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	d.LegalForm, d.LegalName, d.SignerFullName = legalFormProto(p.LegalForm), p.LegalName, p.SignerFullName.String
	if d.BinIin, err = s.openPII(ctx, p.BinIinEnc, partyBinIINAAD(id)); err != nil {
		return nil, false, err
	}
	if p.SignerIinEnc.Valid {
		if d.SignerIin, err = s.openPII(ctx, p.SignerIinEnc.String, partySignerIINAAD(id)); err != nil {
			return nil, false, err
		}
	}
	if p.PayoutIbanEnc.Valid {
		if d.PayoutIban, err = s.openPII(ctx, p.PayoutIbanEnc.String, partyPayoutIBANAAD(id)); err != nil {
			return nil, false, err
		}
	}
	return d, true, nil
}
