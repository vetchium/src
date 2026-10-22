package mesh

import (
	"context"
	"errors"
	"net/http"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/orgs/marketplace/work"
	"github.com/vetchium/src/typespec/problem"
	coordinatorproblem "github.com/vetchium/src/typespec/problem/global-coordinator"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/meshapi"
	"backend/internal/meshidentity"
	"backend/internal/providerwork"
	"backend/internal/workclient"
)

// relayWork serves a relay read of a provider's work: this tenant's own from
// the database, another tenant's through its peer listener. A miss at either
// is the one answer for inaccessible work; any failure to get an answer is an
// unavailable tenant, which the caller reports as incomplete results.
func relayWork[R any, PR interface {
	*R
	apiserver.Request
}, I, O any](
	s *meshapi.Server,
	target func(R) (directoryspec.TenantID, I),
	local func(context.Context, I) (O, error),
	peer func(context.Context, directoryspec.TenantID, I) (workclient.Outcome[O], error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request R
		if !apiserver.Decode(s, w, r, PR(&request)) {
			return
		}
		tenant, inner := target(request)
		var result O
		if string(tenant) == s.TenantID {
			value, err := local(r.Context(), inner)
			if errors.Is(err, providerwork.ErrNotFound) {
				s.Problem(r.Context(), w, orgsproblem.EngagementWorkNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read local provider work", err)
				return
			}
			result = value
		} else {
			outcome, err := peer(r.Context(), tenant, inner)
			if err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == orgsproblem.EngagementWorkNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.EngagementWorkNotFoundError)
				return
			}
			if err != nil || outcome.Problem != nil {
				listingTenantUnavailable(s, w, r, tenant, err, outcome.Problem)
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

// peerWork serves a read from another tenant. Only a caller that homes the
// provider Org the request names is answered; any other gets what a provider
// with nothing routed gets, so a tenant learns nothing about work it does not
// host (MKT-ACC-004).
func peerWork[R any, PR interface {
	*R
	apiserver.Request
}, O any](
	s *meshapi.Server, provider func(R) string,
	read func(context.Context, R) (O, error), empty func() O,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request R
		if !apiserver.Decode(s, w, r, PR(&request)) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalOrg,
				PrincipalDID:  directoryspec.PrincipalDID(provider(request)),
			})
		if err != nil || (details != nil &&
			details.Type != coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			listingTenantUnavailable(s, w, r, caller, err, details)
			return
		}
		var result O
		switch {
		case details != nil || resolved.HomeTenantID != caller:
			if empty == nil {
				s.Problem(r.Context(), w, orgsproblem.EngagementWorkNotFoundError)
				return
			}
			result = empty()
		default:
			value, err := read(r.Context(), request)
			if errors.Is(err, providerwork.ErrNotFound) {
				s.Problem(r.Context(), w, orgsproblem.EngagementWorkNotFoundError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read peer provider work", err)
				return
			}
			result = value
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func RelayListWork(s *meshapi.Server) http.HandlerFunc {
	return relayWork(s,
		func(r work.RelayListWorkRequest) (directoryspec.TenantID, work.PeerListWorkRequest) {
			return r.Tenant, r.Request
		},
		s.ProviderWork.List,
		func(ctx context.Context, tenant directoryspec.TenantID, r work.PeerListWorkRequest) (workclient.Outcome[work.PeerListWorkResponse], error) {
			return s.WorkPeers.PeerListWork(ctx, tenant, r)
		})
}

func RelayGetWork(s *meshapi.Server) http.HandlerFunc {
	return relayWork(s,
		func(r work.RelayGetWorkRequest) (directoryspec.TenantID, work.PeerGetWorkRequest) {
			return r.Tenant, r.Request
		},
		s.ProviderWork.Get,
		func(ctx context.Context, tenant directoryspec.TenantID, r work.PeerGetWorkRequest) (workclient.Outcome[work.WorkDetail], error) {
			return s.WorkPeers.PeerGetWork(ctx, tenant, r)
		})
}

func RelayListJobs(s *meshapi.Server) http.HandlerFunc {
	return relayWork(s,
		func(r work.RelayListJobsRequest) (directoryspec.TenantID, work.PeerListJobsRequest) {
			return r.Tenant, r.Request
		},
		s.ProviderWork.ListJobs,
		func(ctx context.Context, tenant directoryspec.TenantID, r work.PeerListJobsRequest) (workclient.Outcome[work.PeerListJobsResponse], error) {
			return s.WorkPeers.PeerListJobs(ctx, tenant, r)
		})
}

func RelayGetJob(s *meshapi.Server) http.HandlerFunc {
	return relayWork(s,
		func(r work.RelayGetJobRequest) (directoryspec.TenantID, work.PeerGetJobRequest) {
			return r.Tenant, r.Request
		},
		s.ProviderWork.GetJob,
		func(ctx context.Context, tenant directoryspec.TenantID, r work.PeerGetJobRequest) (workclient.Outcome[work.JobDetail], error) {
			return s.WorkPeers.PeerGetJob(ctx, tenant, r)
		})
}

func PeerListWork(s *meshapi.Server) http.HandlerFunc {
	return peerWork(s,
		func(r work.PeerListWorkRequest) string { return string(r.ProviderOrgDID) },
		s.ProviderWork.List,
		func() work.PeerListWorkResponse {
			return work.PeerListWorkResponse{Items: []work.PeerWorkEntry{}}
		})
}

func PeerGetWork(s *meshapi.Server) http.HandlerFunc {
	return peerWork[work.PeerGetWorkRequest](s,
		func(r work.PeerGetWorkRequest) string { return string(r.ProviderOrgDID) },
		s.ProviderWork.Get, nil)
}

func PeerListJobs(s *meshapi.Server) http.HandlerFunc {
	return peerWork(s,
		func(r work.PeerListJobsRequest) string { return string(r.ProviderOrgDID) },
		s.ProviderWork.ListJobs,
		func() work.PeerListJobsResponse {
			return work.PeerListJobsResponse{Jobs: []work.PeerJobEntry{}}
		})
}

func PeerGetJob(s *meshapi.Server) http.HandlerFunc {
	return peerWork[work.PeerGetJobRequest](s,
		func(r work.PeerGetJobRequest) string { return string(r.ProviderOrgDID) },
		s.ProviderWork.GetJob, nil)
}

func RelayListCreditedApplications(s *meshapi.Server) http.HandlerFunc {
	return relayWork(s,
		func(r work.RelayListCreditedApplicationsRequest) (directoryspec.TenantID, work.PeerListCreditedApplicationsRequest) {
			return r.Tenant, r.Request
		},
		s.ProviderWork.ListCreditedApplications,
		func(ctx context.Context, tenant directoryspec.TenantID, r work.PeerListCreditedApplicationsRequest) (workclient.Outcome[work.PeerListCreditedApplicationsResponse], error) {
			return s.WorkPeers.PeerListCreditedApplications(ctx, tenant, r)
		})
}

func PeerListCreditedApplications(s *meshapi.Server) http.HandlerFunc {
	return peerWork(s,
		func(r work.PeerListCreditedApplicationsRequest) string { return string(r.ProviderOrgDID) },
		s.ProviderWork.ListCreditedApplications,
		func() work.PeerListCreditedApplicationsResponse {
			return work.PeerListCreditedApplicationsResponse{Items: []work.CreditedApplicationSummary{}}
		})
}

func RelayGetActivityStatement(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authenticateRelay(s.Runtime, w, r, s.Credential) {
			return
		}
		var request work.RelayGetActivityStatementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		tenant := request.Tenant
		inner := request.Request
		var result work.PeerGetActivityStatementResponse
		if string(tenant) == s.TenantID {
			value, err := s.ProviderWork.GetActivityStatement(r.Context(), inner)
			if errors.Is(err, providerwork.ErrNotFound) {
				s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
				return
			}
			if errors.Is(err, providerwork.ErrInvalidCursor) {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			if err != nil {
				s.InternalError(r.Context(), w, "read local provider statement", err)
				return
			}
			result = value
		} else {
			outcome, err := s.WorkPeers.PeerGetActivityStatement(r.Context(), tenant, inner)
			if err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == orgsproblem.EngagementNotFoundError.Type {
				s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
				return
			}
			if err == nil && outcome.Problem != nil &&
				outcome.Problem.Type == problem.InvalidPaginationKeyError.Type {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			if err != nil || outcome.Problem != nil {
				listingTenantUnavailable(s, w, r, tenant, err, outcome.Problem)
				return
			}
			result = *outcome.Result
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, result)
	}
}

func PeerGetActivityStatement(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, ok := meshidentity.TenantFromContext(r.Context())
		if !ok {
			peerAuthenticationRequired(s, w, r)
			return
		}
		var request work.PeerGetActivityStatementRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		resolved, details, err := s.Directory.ResolvePrincipal(r.Context(),
			directoryspec.ResolvePrincipalRequest{
				PrincipalType: directoryspec.PrincipalOrg,
				PrincipalDID:  directoryspec.PrincipalDID(string(request.ProviderOrgDID)),
			})
		if err != nil || (details != nil &&
			details.Type != coordinatorproblem.DirectoryEntryNotFoundError.Type) {
			listingTenantUnavailable(s, w, r, caller, err, details)
			return
		}
		if details != nil || resolved.HomeTenantID != caller {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		res, err := s.ProviderWork.GetActivityStatement(r.Context(), request)
		if errors.Is(err, providerwork.ErrNotFound) {
			s.Problem(r.Context(), w, orgsproblem.EngagementNotFoundError)
			return
		}
		if errors.Is(err, providerwork.ErrInvalidCursor) {
			s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "peer read activity statement", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, res)
	}
}
