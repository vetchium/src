package directory

import (
	"context"
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
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
		) (globaldirectory.Outcome, error) {
			return service.ReserveHubPrincipal(ctx, caller, request)
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
		) (globaldirectory.Outcome, error) {
			return service.ActivateHubPrincipal(ctx, caller, request)
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
		) (globaldirectory.Outcome, error) {
			return service.SetHubAlias(ctx, caller, request)
		},
	)
}

func commandHandler[T any, P interface {
	*T
	apiserver.Request
}](
	runtime *apiserver.Runtime,
	command func(context.Context, directoryspec.TenantID, T) (
		globaldirectory.Outcome, error,
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
		if outcome.Problem != nil {
			runtime.Problem(r.Context(), w, *outcome.Problem)
			return
		}
		runtime.JSON(r.Context(), w, outcome.Status, outcome.Principal)
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
