package middleware

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	problemspec "github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
)

// RecentAuthenticationWindow is how recently a principal must have completed
// full authentication before a security-sensitive operation is allowed. Every
// portal uses the same window, and the contract documents it as five minutes.
const RecentAuthenticationWindow = 5 * time.Minute

// PortalAuthentication is what one portal contributes to the shared bearer
// session middleware. Everything else about authenticating a session is
// identical between portals, so it lives here rather than once per portal.
type PortalAuthentication[Identity any] struct {
	Runtime *apiserver.Runtime

	// Portal names the portal in structured logs.
	Portal string

	// Challenge is the WWW-Authenticate value returned with a 401.
	Challenge string

	AuthenticationRequired       problemspec.Details
	RecentAuthenticationRequired problemspec.Details

	// Authenticate resolves a session from the hash of its bearer token. It
	// returns pgx.ErrNoRows when no live session matches.
	Authenticate func(context.Context, []byte) (Identity, error)

	// AuthenticatedAt reports when the identity last completed full
	// authentication.
	AuthenticatedAt func(Identity) time.Time

	Store func(context.Context, Identity) context.Context
	Load  func(context.Context) (Identity, bool)

	Now func() time.Time
}

// Session authenticates the bearer token and puts the resulting identity in
// the request context.
func (p PortalAuthentication[Identity]) Session() func(
	http.Handler,
) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			token, ok := bearerToken(r)
			if !ok {
				p.unauthenticated(ctx, w)
				return
			}
			tokenHash := sha256.Sum256([]byte(token))
			identity, err := p.Authenticate(ctx, tokenHash[:])
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					p.Runtime.WarnContext(
						ctx, "authentication failed",
						"event", "authentication_failed",
						"portal", p.Portal,
						"reason", "session_not_found",
						"error", err,
					)
					p.unauthenticated(ctx, w)
					return
				}
				p.Runtime.InternalError(
					ctx, w, "authenticate "+p.Portal+" session", err,
				)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(p.Store(ctx, identity)))
		})
	}
}

// RequireRecentAuthentication rejects a session whose full authentication is
// older than maximumAge, so a stolen live session cannot replace credentials.
func (p PortalAuthentication[Identity]) RequireRecentAuthentication(
	maximumAge time.Duration,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			identity, ok := p.Load(ctx)
			if !ok {
				p.unauthenticated(ctx, w)
				return
			}
			if p.AuthenticatedAt(identity).Before(
				p.Now().Add(-maximumAge),
			) {
				p.Runtime.Problem(
					ctx, w, p.RecentAuthenticationRequired, p.Challenge,
				)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (p PortalAuthentication[Identity]) unauthenticated(
	ctx context.Context, w http.ResponseWriter,
) {
	p.Runtime.Problem(ctx, w, p.AuthenticationRequired, p.Challenge)
}

func bearerToken(r *http.Request) (string, bool) {
	credentials := strings.Fields(r.Header.Get("Authorization"))
	if len(credentials) != 2 ||
		!strings.EqualFold(credentials[0], "Bearer") {
		return "", false
	}
	return credentials[1], true
}
