package account

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs"
	orgsaccount "github.com/vetchium/src/typespec/orgs/account"
	"github.com/vetchium/src/typespec/orgs/authorization"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/dnsverify"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/domainverification"
)

func MyInfo(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		info, err := s.Queries.GetOrgMyInfo(r.Context(), identity.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			unauthenticated(s, w, r)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org my info", err)
			return
		}
		permissions := make([]authorization.OrgPermissionID, 0, len(info.Permissions))
		for _, permission := range info.Permissions {
			permissions = append(
				permissions, authorization.OrgPermissionID(permission),
			)
		}
		s.JSON(r.Context(), w, http.StatusOK, orgsaccount.MyInfoResponse{
			EmailAddress:      common.EmailAddress(info.EmailAddress),
			PreferredLanguage: orgs.FrontendLocale(info.PreferredLanguage),
			Permissions:       permissions,
			TOTPEnabled:       info.TotpEnabled,
			RecoveryCodesRemaining: common.TOTPRecoveryCodeCount(
				info.RecoveryCodesRemaining,
			),
			SessionAuthenticatedAt: identity.AuthenticatedAt.UTC(),
			Org:                    summary(s, info),
		})
	}
}

// CheckDomain looks up the Org's TXT record now. Only a superadmin may, since
// a present record can re-claim a released domain for the whole Org.
func CheckDomain(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		held, err := s.Queries.OrgUserHoldsPermission(
			r.Context(), sqlc.OrgUserHoldsPermissionParams{
				OrgUserID:  identity.UserID,
				Permission: string(authorization.Superadmin),
			},
		)
		if err != nil {
			s.InternalError(r.Context(), w, "check Org permission", err)
			return
		}
		if !held {
			s.Problem(r.Context(), w, orgsproblem.PermissionRequiredError)
			return
		}
		result, err := s.Domains.CheckNow(
			r.Context(), identity.OrgDID, domainverification.Actor{
				Type: "org_user", ID: dbvalue.FormatUUID(identity.UserID),
				Source: "orgs-api",
			},
		)
		if errors.Is(err, domainverification.ErrNotFound) {
			unauthenticated(s, w, r)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "check Org domain", err)
			return
		}
		info, err := s.Queries.GetOrgMyInfo(r.Context(), identity.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			unauthenticated(s, w, r)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org my info", err)
			return
		}
		s.JSON(r.Context(), w, http.StatusOK, orgsaccount.CheckDomainResponse{
			CheckResult: orgsaccount.DomainCheckResult(result),
			Org:         summary(s, info),
		})
	}
}

// summary maps the internal domain lifecycle onto what the portal shows: a
// release in flight is still failing, and a re-claim in flight is still
// released until the directory confirms it.
func summary(s *orgsruntime.Server, info sqlc.GetOrgMyInfoRow) orgsaccount.OrgSummary {
	status := orgsaccount.DomainStatus{
		Domain:         orgs.OrgDomain(info.Domain),
		DNSRecordName:  dnsverify.RecordName(info.Domain),
		DNSRecordValue: dnsverify.RecordValue(info.VerificationToken),
		LastVerifiedAt: info.LastVerifiedAt.Time.UTC(),
	}
	switch info.DomainState {
	case sqlc.VetchiumOrgDomainStateVerified:
		status.State = orgsaccount.DomainVerified
	case sqlc.VetchiumOrgDomainStateFailing,
		sqlc.VetchiumOrgDomainStateReleasing:
		status.State = orgsaccount.DomainFailing
		failingSince := info.FailingSince.Time.UTC()
		releaseAfter := s.Domains.ReleaseAfter(failingSince).UTC()
		status.FailingSince = &failingSince
		status.ReleaseAfter = &releaseAfter
	default:
		status.State = orgsaccount.DomainReleased
	}
	state := orgsaccount.OrgActive
	if info.OrgState == sqlc.VetchiumOrgStateSuspended {
		state = orgsaccount.OrgSuspended
	}
	return orgsaccount.OrgSummary{
		DisplayName: common.DisplayName(info.DisplayName),
		OrgState:    state,
		Domain:      status,
	}
}

func unauthenticated(
	s *orgsruntime.Server, w http.ResponseWriter, r *http.Request,
) {
	s.AuthenticationProblem(
		r.Context(), w, orgsproblem.AuthenticationRequiredError,
		orgsauthn.BearerChallenge,
	)
}
