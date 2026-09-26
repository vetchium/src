package directory

import (
	"context"
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/globaldirectory"
	"backend/internal/meshidentity"
)

const authenticationChallenge = `MutualTLS realm="global-coordinator"`

type Service interface {
	ResolveProfileSlug(
		context.Context, string,
	) (directoryspec.ResolveProfileSlugResponse, error)
	ReserveHubPrincipal(
		context.Context, directoryspec.TenantID,
		directoryspec.ReserveHubPrincipalRequest,
	) (globaldirectory.Outcome, error)
	ActivateHubPrincipal(
		context.Context, directoryspec.TenantID,
		directoryspec.ActivateHubPrincipalRequest,
	) (globaldirectory.Outcome, error)
	SetHubAlias(
		context.Context, directoryspec.TenantID,
		directoryspec.SetHubAliasRequest,
	) (globaldirectory.Outcome, error)
	ResolveOrgDomain(
		context.Context, orgs.OrgDomain,
	) (directoryspec.ResolveOrgDomainResponse, error)
	ReserveOrgPrincipal(
		context.Context, directoryspec.TenantID,
		directoryspec.ReserveOrgPrincipalRequest,
	) (globaldirectory.OrgOutcome, error)
	ActivateOrgPrincipal(
		context.Context, directoryspec.TenantID,
		directoryspec.ActivateOrgPrincipalRequest,
	) (globaldirectory.OrgOutcome, error)
	ReleaseOrgDomain(
		context.Context, directoryspec.TenantID,
		directoryspec.ReleaseOrgDomainRequest,
	) (globaldirectory.OrgOutcome, error)
	ClaimOrgDomain(
		context.Context, directoryspec.TenantID,
		directoryspec.ClaimOrgDomainRequest,
	) (globaldirectory.OrgOutcome, error)
}

func ResolveProfileSlug(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticate(runtime, w, r); !ok {
			return
		}
		var request directoryspec.ResolveProfileSlugRequest
		if !apiserver.Decode(runtime, w, r, &request) {
			return
		}
		response, err := service.ResolveProfileSlug(r.Context(), request.Slug)
		if errors.Is(err, globaldirectory.ErrNotFound) {
			runtime.Problem(
				r.Context(), w,
				coordinatorproblem.DirectoryEntryNotFoundError,
			)
			return
		}
		if err != nil {
			runtime.InternalError(r.Context(), w, "resolve profile slug", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ReserveHubPrincipal(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ReserveHubPrincipalRequest,
		*directoryspec.ReserveHubPrincipalRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ReserveHubPrincipalRequest,
		) (commandOutcome, error) {
			return hubOutcome(service.ReserveHubPrincipal(ctx, caller, request))
		},
	)
}

func ActivateHubPrincipal(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ActivateHubPrincipalRequest,
		*directoryspec.ActivateHubPrincipalRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ActivateHubPrincipalRequest,
		) (commandOutcome, error) {
			return hubOutcome(service.ActivateHubPrincipal(ctx, caller, request))
		},
	)
}

func SetHubAlias(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.SetHubAliasRequest,
		*directoryspec.SetHubAliasRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.SetHubAliasRequest,
		) (commandOutcome, error) {
			return hubOutcome(service.SetHubAlias(ctx, caller, request))
		},
	)
}

// commandOutcome is a directory command result independent of the principal
// kind whose response it carries.
type commandOutcome struct {
	status  int
	body    any
	problem *problem.Details
}

func hubOutcome(
	outcome globaldirectory.Outcome, err error,
) (commandOutcome, error) {
	return commandOutcome{
		status: outcome.Status, body: outcome.Principal,
		problem: outcome.Problem,
	}, err
}

func orgOutcome(
	outcome globaldirectory.OrgOutcome, err error,
) (commandOutcome, error) {
	return commandOutcome{
		status: outcome.Status, body: outcome.Org, problem: outcome.Problem,
	}, err
}

func ResolveOrgDomain(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticate(runtime, w, r); !ok {
			return
		}
		var request directoryspec.ResolveOrgDomainRequest
		if !apiserver.Decode(runtime, w, r, &request) {
			return
		}
		response, err := service.ResolveOrgDomain(r.Context(), request.Domain)
		if errors.Is(err, globaldirectory.ErrNotFound) {
			runtime.Problem(
				r.Context(), w,
				coordinatorproblem.DirectoryEntryNotFoundError,
			)
			return
		}
		if err != nil {
			runtime.InternalError(r.Context(), w, "resolve Org domain", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, http.StatusOK, response)
	}
}

func ReserveOrgPrincipal(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ReserveOrgPrincipalRequest,
		*directoryspec.ReserveOrgPrincipalRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ReserveOrgPrincipalRequest,
		) (commandOutcome, error) {
			return orgOutcome(service.ReserveOrgPrincipal(ctx, caller, request))
		},
	)
}

func ActivateOrgPrincipal(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ActivateOrgPrincipalRequest,
		*directoryspec.ActivateOrgPrincipalRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ActivateOrgPrincipalRequest,
		) (commandOutcome, error) {
			return orgOutcome(service.ActivateOrgPrincipal(ctx, caller, request))
		},
	)
}

func ReleaseOrgDomain(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ReleaseOrgDomainRequest,
		*directoryspec.ReleaseOrgDomainRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ReleaseOrgDomainRequest,
		) (commandOutcome, error) {
			return orgOutcome(service.ReleaseOrgDomain(ctx, caller, request))
		},
	)
}

func ClaimOrgDomain(
	runtime *apiserver.Runtime, service Service,
) http.HandlerFunc {
	return commandHandler[
		directoryspec.ClaimOrgDomainRequest,
		*directoryspec.ClaimOrgDomainRequest,
	](
		runtime,
		func(
			ctx context.Context, caller directoryspec.TenantID,
			request directoryspec.ClaimOrgDomainRequest,
		) (commandOutcome, error) {
			return orgOutcome(service.ClaimOrgDomain(ctx, caller, request))
		},
	)
}

func commandHandler[T any, P interface {
	*T
	apiserver.Request
}](
	runtime *apiserver.Runtime,
	command func(context.Context, directoryspec.TenantID, T) (
		commandOutcome, error,
	),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := authenticate(runtime, w, r)
		if !ok {
			return
		}
		var request T
		if !apiserver.Decode(runtime, w, r, P(&request)) {
			return
		}
		outcome, err := command(r.Context(), caller, request)
		if err != nil {
			runtime.InternalError(r.Context(), w, "run directory command", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if outcome.problem != nil {
			runtime.Problem(r.Context(), w, *outcome.problem)
			return
		}
		runtime.JSON(r.Context(), w, outcome.status, outcome.body)
	}
}

func authenticate(
	runtime *apiserver.Runtime, w http.ResponseWriter, r *http.Request,
) (directoryspec.TenantID, bool) {
	tenantID, ok := meshidentity.TenantFromContext(r.Context())
	if !ok {
		runtime.AuthenticationProblem(
			r.Context(), w,
			coordinatorproblem.DirectoryAuthenticationRequiredError,
			authenticationChallenge,
		)
		return "", false
	}
	return tenantID, true
}
