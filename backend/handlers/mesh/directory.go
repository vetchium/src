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
}

func ResolveProfileSlug(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(runtime, w, r, credential) {
			return
		}
		var request directoryspec.ResolveProfileSlugRequest
		if !apiserver.Decode(runtime, w, r, &request) {
			return
		}
		response, details, err := directory.ResolveProfileSlug(r.Context(), request)
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
		runtime, credential, directory.ReserveHubPrincipal,
	)
}

func ActivateHubPrincipal(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.ActivateHubPrincipalRequest](
		runtime, credential, directory.ActivateHubPrincipal,
	)
}

func SetHubAlias(
	runtime *apiserver.Runtime, directory Directory, credential string,
) http.HandlerFunc {
	return directoryCommand[directoryspec.SetHubAliasRequest](
		runtime, credential, directory.SetHubAlias,
	)
}

func directoryCommand[T any, P interface {
	*T
	apiserver.Request
}](
	runtime *apiserver.Runtime, credential string,
	command func(context.Context, T) (directoryclient.Outcome, error),
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
		if outcome.Problem != nil {
			if isCoordinatorAuthenticationProblem(outcome.Problem) {
				runtime.InternalError(r.Context(), w, "authenticate directory relay", fmt.Errorf("coordinator rejected mesh certificate"))
				return
			}
			runtime.Problem(r.Context(), w, *outcome.Problem)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		runtime.JSON(r.Context(), w, outcome.Status, outcome.Principal)
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
