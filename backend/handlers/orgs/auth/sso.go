package auth

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	orgsauth "github.com/vetchium/src/typespec/orgs/auth"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/entitlements"
)

const (
	googleProvider = "google"

	// ssoStateTTL is how long a started sign-in may take at the provider.
	ssoStateTTL = 10 * time.Minute
)

// StartGoogleSignIn answers the same for every domain, registered or not, so
// it cannot be used to learn which Orgs exist or have the feature on.
func StartGoogleSignIn(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request orgsauth.StartGoogleSignInRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if s.GoogleSignIn == nil {
			s.Problem(r.Context(), w, orgsproblem.SSONotAvailableError)
			return
		}
		state, stateHash, err := credentials.NewToken()
		if err != nil {
			s.InternalError(r.Context(), w, "generate SSO state", err)
			return
		}
		nonce, nonceHash, err := credentials.NewToken()
		if err != nil {
			s.InternalError(r.Context(), w, "generate SSO nonce", err)
			return
		}
		verifier := s.GoogleSignIn.NewVerifier()
		sealed, err := credentials.Encrypt(
			s.CredentialSubkey("sso-verifier"), []byte(verifier),
		)
		if err != nil {
			s.InternalError(r.Context(), w, "seal SSO verifier", err)
			return
		}
		location, err := s.GoogleSignIn.AuthorizationURL(
			r.Context(), state, nonce, verifier, string(request.Domain),
		)
		if err != nil {
			s.InternalError(r.Context(), w, "build SSO authorization URL", err)
			return
		}
		if err := s.Queries.CreateOrgSSOLoginState(
			r.Context(), sqlc.CreateOrgSSOLoginStateParams{
				StateHash:          stateHash,
				Provider:           googleProvider,
				Domain:             string(request.Domain),
				NonceHash:          nonceHash,
				VerifierCiphertext: sealed,
				ExpiresAt:          dbvalue.Timestamp(s.CurrentTime().Add(ssoStateTTL)),
			},
		); err != nil {
			s.InternalError(r.Context(), w, "store SSO login state", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, orgsauth.StartGoogleSignInResponse{
			AuthorizationURL: location,
		})
	}
}

// CompleteGoogleSignIn applies D22 in order and D23 (no Vetchium TOTP). Every
// refusal before the user is known to be a member of the Org with the feature
// on is the same generic problem; the reason goes to the log only.
func CompleteGoogleSignIn(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		var request orgsauth.CompleteGoogleSignInRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		if s.GoogleSignIn == nil {
			s.Problem(ctx, w, orgsproblem.SSONotAvailableError)
			return
		}
		refuse := func(reason string, err error) {
			s.WarnContext(ctx, "Org Google sign-in refused",
				"event", "org_sso_refused", "reason", reason, "error", err)
			s.AuthenticationProblem(
				ctx, w, orgsproblem.SSOSignInFailedError,
				orgsauthn.LoginChallenge,
			)
		}

		login, err := s.Queries.ConsumeOrgSSOLoginState(
			ctx, sqlc.ConsumeOrgSSOLoginStateParams{
				StateHash: credentials.TokenHash(string(request.State)),
				Provider:  googleProvider,
			},
		)
		if errors.Is(err, pgx.ErrNoRows) {
			refuse("unknown, replayed or expired state", nil)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "consume SSO login state", err)
			return
		}
		verifier, err := credentials.Decrypt(
			s.CredentialSubkey("sso-verifier"), login.VerifierCiphertext,
		)
		if err != nil {
			s.InternalError(ctx, w, "open SSO verifier", err)
			return
		}
		claims, err := s.GoogleSignIn.Exchange(ctx, request.Code, string(verifier))
		if err != nil {
			refuse("code exchange", err)
			return
		}
		if subtle.ConstantTimeCompare(
			credentials.TokenHash(claims.Nonce), login.NonceHash,
		) != 1 {
			refuse("nonce mismatch", nil)
			return
		}
		email := strings.ToLower(claims.Email)
		switch {
		case claims.Subject == "":
			refuse("no subject", nil)
			return
		case !claims.EmailVerified:
			refuse("email not verified", nil)
			return
		case !strings.EqualFold(claims.HostedDomain, login.Domain):
			refuse("hosted domain differs from the Org domain", nil)
			return
		case !strings.HasSuffix(email, "@"+login.Domain):
			refuse("email outside the Org domain", nil)
			return
		}

		user, err := s.Queries.GetOrgUserForSSO(ctx, sqlc.GetOrgUserForSSOParams{
			Provider:     googleProvider,
			Subject:      claims.Subject,
			EmailAddress: email,
			Domain:       login.Domain,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			refuse("no such Org user", nil)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "get Org user for SSO", err)
			return
		}
		switch {
		case !subscriptionspec.AllowsGoogleSignIn(
			subscriptionspec.Plan(user.OrgPlanOid),
		):
			refuse("Org plan does not include Google sign-in", nil)
			return
		case !user.GoogleSignInEnabled:
			refuse("Google sign-in is off for the Org", nil)
			return
		case user.SubjectOwnerID.Valid && user.SubjectOwnerID != user.OrgUserID:
			refuse("subject is linked to another user", nil)
			return
		case user.LinkedSubject != "" && user.LinkedSubject != claims.Subject:
			refuse("user is linked to another subject", nil)
			return
		}
		if user.OrgUserState != sqlc.VetchiumOrgUserStateActive {
			if user.DisabledReason.String == "nonpayment" {
				s.Problem(ctx, w, orgsproblem.OrgUserDisabledNonpaymentError)
				return
			}
			s.Problem(ctx, w, orgsproblem.OrgUserDisabledError)
			return
		}

		token, tokenHash, err := credentials.NewToken()
		if err != nil {
			s.InternalError(ctx, w, "generate Org session token", err)
			return
		}
		expiresAt := s.CurrentTime().Add(s.SessionTTL)
		session, err := s.Queries.CreateOrgSSOSession(
			ctx, sqlc.CreateOrgSSOSessionParams{
				OrgUserID: user.OrgUserID,
				GoogleSignInPlanOids: entitlements.PlanOIDs(
					subscriptionspec.AllowsGoogleSignIn,
				),
				Domain:           login.Domain,
				Provider:         googleProvider,
				Subject:          claims.Subject,
				SessionTokenHash: tokenHash,
				ExpiresAt:        dbvalue.Timestamp(expiresAt),
				TenantID:         s.TenantID,
			},
		)
		var pgErr *pgconn.PgError
		if errors.Is(err, pgx.ErrNoRows) ||
			(errors.As(err, &pgErr) && pgErr.Code == "23505") {
			refuse("sign-in conditions changed", err)
			return
		}
		if err != nil {
			s.InternalError(ctx, w, "create Org SSO session", err)
			return
		}
		if session.ExpiresAt.Valid {
			expiresAt = session.ExpiresAt.Time
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(ctx, w, http.StatusOK, sessionResponse(
			token, expiresAt, user.PreferredLanguage,
		))
	}
}
