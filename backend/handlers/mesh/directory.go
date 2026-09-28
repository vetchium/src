package mesh

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/directoryclient"
)

type Directory interface {
	ResolveProfileSlug(
		context.Context, directoryspec.ResolveProfileSlugRequest,
	) (directoryspec.ResolveProfileSlugResponse, *problem.Details, error)
	ReserveHubPrincipal(
		context.Context, directoryspec.ReserveHubPrincipalRequest,
	) (directoryclient.Outcome, error)
	ActivateHubPrincipal(
		context.Context, directoryspec.ActivateHubPrincipalRequest,
	) (directoryclient.Outcome, error)
	SetHubAlias(
		context.Context, directoryspec.SetHubAliasRequest,
	) (directoryclient.Outcome, error)
	ResolveOrgDomain(
		context.Context, directoryspec.ResolveOrgDomainRequest,
	) (directoryspec.ResolveOrgDomainResponse, *problem.Details, error)
	ReserveOrgPrincipal(
		context.Context, directoryspec.ReserveOrgPrincipalRequest,
	) (directoryclient.OrgOutcome, error)
	ActivateOrgPrincipal(
		context.Context, directoryspec.ActivateOrgPrincipalRequest,
	) (directoryclient.OrgOutcome, error)
	ReleaseOrgDomain(
		context.Context, directoryspec.ReleaseOrgDomainRequest,
	) (directoryclient.OrgOutcome, error)
	ClaimOrgDomain(
		context.Context, directoryspec.ClaimOrgDomainRequest,
	) (directoryclient.OrgOutcome, error)
	ResolveHubAccountEmail(
		context.Context, directoryspec.ResolveHubAccountEmailRequest,
	) (directoryspec.ResolveHubAccountEmailResponse, *problem.Details, error)
	ReserveHubAccountEmailChange(
		context.Context, directoryspec.ReserveHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
	FinalizeHubAccountEmailChange(
		context.Context, directoryspec.FinalizeHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
	AbandonHubAccountEmailChange(
		context.Context, directoryspec.AbandonHubAccountEmailChangeRequest,
	) (directoryclient.EmailChangeOutcome, error)
}

func ResolveProfileSlug(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return relayRead(runtime, credential, directory.ResolveProfileSlug)
}

func ResolveOrgDomain(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return relayRead(runtime, credential, directory.ResolveOrgDomain)
}

func relayRead[T, R any, P interface {
	*T
	apiserver.Request
}](
	runtime *apiserver.Runtime, credential string,
	read func(context.Context, T) (R, *problem.Details, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(runtime, w, r, credential) {
			return
		}
		var request T
		if !apiserver.Decode(runtime, w, r, P(&request)) {
			return
		}
		response, details, err := read(r.Context(), request)
		if err != nil {
			runtime.InternalError(r.Context(), w, "relay directory lookup", err)
			return
		}
		if details != nil {
			if isCoordinatorAuthenticationProblem(details) {
				runtime.InternalError(r.Context(), w, "authenticate directory relay", fmt.Errorf("coordinator rejected mesh certificate"))
				return
			}
			runtime.Problem(r.Context(), w, *details)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ReserveHubPrincipal(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ReserveHubPrincipalRequest](
		runtime, credential, hubCommand(directory.ReserveHubPrincipal),
	)
}

func ActivateHubPrincipal(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ActivateHubPrincipalRequest](
		runtime, credential, hubCommand(directory.ActivateHubPrincipal),
	)
}

func SetHubAlias(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.SetHubAliasRequest](
		runtime, credential, hubCommand(directory.SetHubAlias),
	)
}

func ReserveOrgPrincipal(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ReserveOrgPrincipalRequest](
		runtime, credential, orgCommand(directory.ReserveOrgPrincipal),
	)
}

func ActivateOrgPrincipal(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ActivateOrgPrincipalRequest](
		runtime, credential, orgCommand(directory.ActivateOrgPrincipal),
	)
}

func ReleaseOrgDomain(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ReleaseOrgDomainRequest](
		runtime, credential, orgCommand(directory.ReleaseOrgDomain),
	)
}

func ClaimOrgDomain(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ClaimOrgDomainRequest](
		runtime, credential, orgCommand(directory.ClaimOrgDomain),
	)
}

func ResolveHubAccountEmail(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return relayRead(runtime, credential, directory.ResolveHubAccountEmail)
}

func ReserveHubAccountEmailChange(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ReserveHubAccountEmailChangeRequest](
		runtime, credential, emailChangeCommand(directory.ReserveHubAccountEmailChange),
	)
}

func FinalizeHubAccountEmailChange(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.FinalizeHubAccountEmailChangeRequest](
		runtime, credential, emailChangeCommand(directory.FinalizeHubAccountEmailChange),
	)
}

func AbandonHubAccountEmailChange(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.AbandonHubAccountEmailChangeRequest](
		runtime, credential, emailChangeCommand(directory.AbandonHubAccountEmailChange),
	)
}

// relayOutcome is a relayed command result independent of the principal kind
// whose response it carries.
type relayOutcome struct {
	status  int
	body    any
	problem *problem.Details
}

func hubCommand[T any](
	command func(context.Context, T) (directoryclient.Outcome, error),
) func(context.Context, T) (relayOutcome, error) {
	return func(ctx context.Context, request T) (relayOutcome, error) {
		outcome, err := command(ctx, request)
		return relayOutcome{
			status: outcome.Status, body: outcome.Principal,
			problem: outcome.Problem,
		}, err
	}
}

func orgCommand[T any](
	command func(context.Context, T) (directoryclient.OrgOutcome, error),
) func(context.Context, T) (relayOutcome, error) {
	return func(ctx context.Context, request T) (relayOutcome, error) {
		outcome, err := command(ctx, request)
		return relayOutcome{
			status: outcome.Status, body: outcome.Org, problem: outcome.Problem,
		}, err
	}
}

func emailChangeCommand[T any](
	command func(context.Context, T) (directoryclient.EmailChangeOutcome, error),
) func(context.Context, T) (relayOutcome, error) {
	return func(ctx context.Context, request T) (relayOutcome, error) {
		outcome, err := command(ctx, request)
		return relayOutcome{
			status: outcome.Status, body: outcome.Reservation,
			problem: outcome.Problem,
		}, err
	}
}

func directoryCommand[T any, P interface {
	*T
	apiserver.Request
}](
	runtime *apiserver.Runtime, credential string,
	command func(context.Context, T) (relayOutcome, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(runtime, w, r, credential) {
			return
		}
		var request T
		if !apiserver.Decode(runtime, w, r, P(&request)) {
			return
		}
		outcome, err := command(r.Context(), request)
		if err != nil {
			runtime.InternalError(r.Context(), w, "relay directory command", err)
			return
		}
		if outcome.problem != nil {
			if isCoordinatorAuthenticationProblem(outcome.problem) {
				runtime.InternalError(r.Context(), w, "authenticate directory relay", fmt.Errorf("coordinator rejected mesh certificate"))
				return
			}
			runtime.Problem(r.Context(), w, *outcome.problem)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, outcome.status, outcome.body)
	}
}

func authenticateRelay(
	runtime *apiserver.Runtime, w http.ResponseWriter, r *http.Request,
	credential string,
) bool {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	got, want := sha256.Sum256([]byte(token)), sha256.Sum256([]byte(credential))
	if credential == "" || !ok || !strings.EqualFold(scheme, "Bearer") ||
		subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
		runtime.AuthenticationProblem(
			r.Context(), w,
			coordinatorproblem.MeshRelayAuthenticationRequiredError,
			`Bearer realm="mesh-api"`,
		)
		return false
	}
	return true
}

func isCoordinatorAuthenticationProblem(details *problem.Details) bool {
	return details.Type == coordinatorproblem.DirectoryAuthenticationRequiredError.Type ||
		details.Type == coordinatorproblem.AuthenticationRequiredError.Type
}
