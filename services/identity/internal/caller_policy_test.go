package internal

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/tools/services"
)

// callWithEmptyRequest вызывает метод с пустым запросом: проверка вызывающего стоит первой
// строкой обработчика, поэтому до базы пустой запрос не доходит (его отклонит валидация).
// Новый RPC без записи здесь валит TestCallerPolicyCoversEveryRPC.
var callWithEmptyRequest = map[string]func(context.Context, identityv1connect.IdentityServiceClient) error{
	"RequestOtp": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.RequestOtp(ctx, &identityv1.RequestOtpRequest{})
		return err
	},
	"VerifyOtp": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.VerifyOtp(ctx, &identityv1.VerifyOtpRequest{})
		return err
	},
	"Authenticate": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.Authenticate(ctx, &identityv1.AuthenticateRequest{})
		return err
	},
	"SignOut": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SignOut(ctx, &identityv1.SignOutRequest{})
		return err
	},
	"SignOutEverywhere": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SignOutEverywhere(ctx, &identityv1.SignOutEverywhereRequest{})
		return err
	},
	"SwitchRole": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SwitchRole(ctx, &identityv1.SwitchRoleRequest{})
		return err
	},
	"GrantRole": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.GrantRole(ctx, &identityv1.GrantRoleRequest{})
		return err
	},
	"StartDemoSession": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.StartDemoSession(ctx, &identityv1.StartDemoSessionRequest{})
		return err
	},
	"SeedUsers": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SeedUsers(ctx, &identityv1.SeedUsersRequest{})
		return err
	},
	"ResetDemo": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ResetDemo(ctx, &identityv1.ResetDemoRequest{})
		return err
	},
	"GetSigningKeys": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.GetSigningKeys(ctx, &identityv1.GetSigningKeysRequest{})
		return err
	},
	"RevealPartyDetails": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.RevealPartyDetails(ctx, &identityv1.RevealPartyDetailsRequest{})
		return err
	},
	"GetProfile": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.GetProfile(ctx, &identityv1.GetProfileRequest{})
		return err
	},
	"StartTotpEnrollment": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.StartTotpEnrollment(ctx, &identityv1.StartTotpEnrollmentRequest{})
		return err
	},
	"ConfirmTotpEnrollment": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ConfirmTotpEnrollment(ctx, &identityv1.ConfirmTotpEnrollmentRequest{})
		return err
	},
	"VerifySecondFactor": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.VerifySecondFactor(ctx, &identityv1.VerifySecondFactorRequest{})
		return err
	},
	"RecordPerson": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.RecordPerson(ctx, &identityv1.RecordPersonRequest{})
		return err
	},
	"UpdateContacts": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.UpdateContacts(ctx, &identityv1.UpdateContactsRequest{})
		return err
	},
	"RegisterParty": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.RegisterParty(ctx, &identityv1.RegisterPartyRequest{})
		return err
	},
	"ProvisionExecutor": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ProvisionExecutor(ctx, &identityv1.ProvisionExecutorRequest{})
		return err
	},
	"SetPayoutIban": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SetPayoutIban(ctx, &identityv1.SetPayoutIbanRequest{})
		return err
	},
	"VerifySignerIin": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.VerifySignerIin(ctx, &identityv1.VerifySignerIinRequest{})
		return err
	},
	"SubmitKyc": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.SubmitKyc(ctx, &identityv1.SubmitKycRequest{})
		return err
	},
	"ListKycQueue": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ListKycQueue(ctx, &identityv1.ListKycQueueRequest{})
		return err
	},
	"ReviewKyc": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ReviewKyc(ctx, &identityv1.ReviewKycRequest{})
		return err
	},
	"GrantConsent": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.GrantConsent(ctx, &identityv1.GrantConsentRequest{})
		return err
	},
	"RevokeConsent": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.RevokeConsent(ctx, &identityv1.RevokeConsentRequest{})
		return err
	},
	"ListMyConsents": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ListMyConsents(ctx, &identityv1.ListMyConsentsRequest{})
		return err
	},
	"HasConsents": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.HasConsents(ctx, &identityv1.HasConsentsRequest{})
		return err
	},
	"ListConsentRevocations": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ListConsentRevocations(ctx, &identityv1.ListConsentRevocationsRequest{})
		return err
	},
	"ResolveConsentRevocation": func(ctx context.Context, c identityv1connect.IdentityServiceClient) error {
		_, err := c.ResolveConsentRevocation(ctx, &identityv1.ResolveConsentRevocationRequest{})
		return err
	},
}

// notYetImplemented — RPC плана 2б, чьи обработчики ещё не написаны: их отвечает заглушка
// connect (Unimplemented) без проверки вызывающего. Тест требует от такого метода именно
// Unimplemented: появился обработчик, а запись осталась — тест падает, запись убирают, и
// политика вызывающих начинает проверяться.
var notYetImplemented = map[string]bool{
	"RevealPartyDetails":       true,
	"GetProfile":               true,
	"StartTotpEnrollment":      true,
	"ConfirmTotpEnrollment":    true,
	"VerifySecondFactor":       true,
	"RecordPerson":             true,
	"UpdateContacts":           true,
	"RegisterParty":            true,
	"ProvisionExecutor":        true,
	"SetPayoutIban":            true,
	"VerifySignerIin":          true,
	"SubmitKyc":                true,
	"ListKycQueue":             true,
	"ReviewKyc":                true,
	"GrantConsent":             true,
	"RevokeConsent":            true,
	"ListMyConsents":           true,
	"HasConsents":              true,
	"ListConsentRevocations":   true,
	"ResolveConsentRevocation": true,
}

// allowedCallers — таблица «метод → кто может звать» (она же в комментарии Serve в run.go).
func allowedCallers(method string) []string {
	if method == "GetSigningKeys" {
		return services.Go
	}
	return []string{"web"}
}

// TestCallerPolicyCoversEveryRPC обходит все RPC дескриптора сервиса и проверяет, кого
// пускает каждый: новый метод без решения о вызывающих валит тест.
func TestCallerPolicyCoversEveryRPC(t *testing.T) {
	h := newHarness(t, nil)
	methods := identityv1.File_senim_identity_v1_identity_proto.Services().ByName("IdentityService").Methods()
	if methods.Len() != len(callWithEmptyRequest) {
		t.Fatalf("в дескрипторе %d RPC, в таблице вызовов %d: добавьте метод в таблицу и в политику", methods.Len(), len(callWithEmptyRequest))
	}
	callers := append([]string{"operator", "edge"}, append([]string{"web"}, services.Go...)...)
	for i := range methods.Len() {
		name := string(methods.Get(i).Name())
		call, ok := callWithEmptyRequest[name]
		if !ok {
			t.Fatalf("RPC %s: нет решения о вызывающих (таблица вызовов и allowedCallers)", name)
		}
		if notYetImplemented[name] {
			_, err := idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*struct{}, error) {
				return nil, call(ctx, c)
			})
			if connect.CodeOf(err) != connect.CodeUnimplemented {
				t.Errorf("%s: обработчик уже есть (err=%v) — уберите метод из notYetImplemented", name, err)
			}
			continue
		}
		allowed := allowedCallers(name)
		for _, caller := range callers {
			permitted := slices.Contains(allowed, caller)
			_, err := idc(h, caller, func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*struct{}, error) {
				return nil, call(ctx, c)
			})
			code, reason := callerRefusal(err)
			forbidden := code == connect.CodePermissionDenied && reason == "caller_forbidden"
			if permitted == forbidden {
				t.Errorf("%s от %s: err=%v; разрешён=%v, отказ по вызывающему=%v", name, caller, err, permitted, forbidden)
			}
		}
		// Без XFCC (mesh сам) вызывающего нет — отказ.
		_, err := idc(h, "", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*struct{}, error) {
			return nil, call(ctx, c)
		})
		if code, reason := callerRefusal(err); code != connect.CodePermissionDenied || reason != "caller_forbidden" {
			t.Errorf("%s без вызывающего: %v, want caller_forbidden", name, err)
		}
	}
}

// callerRefusal — gRPC-код и код ErrorDetail ошибки; для успеха и ошибок без детали — пусто.
func callerRefusal(err error) (connect.Code, string) {
	var ce *connect.Error
	if !errors.As(err, &ce) {
		return 0, ""
	}
	for _, d := range ce.Details() {
		if msg, derr := connectproto.UnmarshalErrorDetail(d); derr == nil {
			if ed, ok := msg.(*commonv1.ErrorDetail); ok {
				return ce.Code(), ed.GetCode()
			}
		}
	}
	return ce.Code(), ""
}
